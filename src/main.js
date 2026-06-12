import { startAudio, stopAudio } from './audio/capture.js';
import { updateKeyDisplay } from './ui/key-display.js';
import { updateNotesDisplay } from './ui/notes-display.js';
import { updateFingerboard } from './ui/fingerboard.js';
import { DEFAULT_DETECTOR_ID, getDetectorOptions } from './detection/factory.js';

console.log('Fiddlekey app started');

const MIN_SETTLED_AUDIO_MS = 10_000;

const startButton = document.getElementById('startButton');
const detectorSelect = document.getElementById('detectorSelect');
const installButton = document.getElementById('installButton');
const onboarding = document.getElementById('onboarding');
const closeOnboarding = document.getElementById('closeOnboarding');
const keyDisplayContainer = document.getElementById('key-display');
const errorMessage = document.getElementById('error-message');

let isAnalyzing = false;
let bestDetection = null;
let deferredPrompt;

// --- Audio Controls ---
if (startButton) {
  startButton.addEventListener('click', async () => {
    if (!isAnalyzing) {
      await detectKey();
    }
  });
}

// --- Settings ---
function initDetectorSettings() {
  if (!detectorSelect) return;

  const detectorOptions = getDetectorOptions();
  detectorSelect.innerHTML = '';

  for (const detector of detectorOptions) {
    const option = document.createElement('option');
    option.value = detector.id;
    option.textContent = detector.label;
    detectorSelect.appendChild(option);
  }

  const storedDetectorId = localStorage.getItem('fiddlekey_detector_id') || DEFAULT_DETECTOR_ID;
  const validDetector = detectorOptions.some(detector => detector.id === storedDetectorId)
    ? storedDetectorId
    : DEFAULT_DETECTOR_ID;
  detectorSelect.value = validDetector;
  localStorage.setItem('fiddlekey_detector_id', validDetector);

  detectorSelect.addEventListener('change', () => {
    localStorage.setItem('fiddlekey_detector_id', detectorSelect.value);
  });
}

function getSelectedDetectorId() {
  return localStorage.getItem('fiddlekey_detector_id') || DEFAULT_DETECTOR_ID;
}

initDetectorSettings();

// --- PWA Installation ---
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installButton) {
    installButton.style.display = 'block';
  }
});

if (installButton) {
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
    installButton.style.display = 'none';
  });
}

window.addEventListener('appinstalled', () => {
  console.log('Fiddlekey was installed');
  if (installButton) {
    installButton.style.display = 'none';
  }
});

// --- Onboarding Logic ---
function initOnboarding() {
  const hasVisited = localStorage.getItem('fiddlekey_visited');
  if (!hasVisited && onboarding) {
    onboarding.style.display = 'flex';
  }

  if (closeOnboarding) {
    closeOnboarding.addEventListener('click', () => {
      if (onboarding) {
        onboarding.style.display = 'none';
      }
      localStorage.setItem('fiddlekey_visited', 'true');
    });
  }
}

initOnboarding();

async function detectKey() {
  try {
    if (errorMessage) errorMessage.textContent = '';
    bestDetection = null;
    clearDisplays();
    setAnalyzingUI(true, 'Initializing...');

    const audioState = await startAudio({
      detectorId: getSelectedDetectorId()
    });
    isAnalyzing = true;

    // Ensure AudioContext is resumed (browser security requirement)
    if (audioState.audioContext.state === 'suspended') {
      await audioState.audioContext.resume();
    }

    setAnalyzingUI(true, 'Analyzing...');

    audioState.worker.onmessage = async (event) => {
      const data = event.data;

      if (data.type === 'detection_update') {
        if (data.detection) {
          bestDetection = data.detection;
          window.dispatchEvent(new CustomEvent('fiddlekey:detection', { detail: data.detection }));

          if ((data.audioProcessedMs ?? 0) >= MIN_SETTLED_AUDIO_MS) {
            await showSettledKey(bestDetection);
          }
        }
      } else if (data.type === 'detector_error') {
        if (errorMessage) {
          errorMessage.textContent = `Error: Failed to initialize detector ${data.detectorId}: ${data.message || 'Unknown error'}.`;
        }
        await resetAnalysisState({ clearResults: true });
      }
    };

    console.log('Audio pipeline active');
  } catch (error) {
    console.error('Permission denied or error:', error);

    await resetAnalysisState({ clearResults: true });

    if (errorMessage) {
      errorMessage.textContent = 'Error: Microphone access is required. Please check your browser permissions.';
    }
  }
}

async function showSettledKey(detection) {
  if (!isAnalyzing || !detection) return;

  isAnalyzing = false;
  updateKeyDisplay(detection);
  updateNotesDisplay(detection);
  updateFingerboard(detection);
  await resetAnalysisState({ clearResults: false });
}

async function resetAnalysisState({ clearResults }) {
  try {
    await stopAudio();
  } catch (error) {
    console.error('Error stopping audio:', error);
  }

  isAnalyzing = false;
  bestDetection = null;
  setAnalyzingUI(false);

  if (clearResults) {
    clearDisplays();
  }
}

function setAnalyzingUI(analyzing, text = '') {
  if (startButton) {
    startButton.disabled = analyzing;
    startButton.textContent = analyzing ? text : 'Detect key';
  }

  if (detectorSelect) {
    detectorSelect.disabled = analyzing;
  }

  if (!keyDisplayContainer) return;

  keyDisplayContainer.classList.toggle('is-listening', analyzing);
  keyDisplayContainer.classList.toggle('is-analyzing', analyzing);

  const keyBadge = keyDisplayContainer.querySelector('.key-badge');
  const status = keyDisplayContainer.querySelector('.analysis-status');
  const confidenceBar = keyDisplayContainer.querySelector('.confidence-fill');

  if (analyzing) {
    if (keyBadge) keyBadge.textContent = 'Analyzing...';
    if (status) status.textContent = 'Listening for 10 seconds to ensure accurate detection.';
    if (confidenceBar) {
      confidenceBar.style.width = '100%';
      confidenceBar.className = 'confidence-fill status-analyzing';
    }
  } else if (status) {
    status.textContent = '';
  }
}

function clearDisplays() {
  updateKeyDisplay(null);
  updateNotesDisplay(null);
  updateFingerboard(null);
}
