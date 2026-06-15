import { startAudio, stopAudio } from './audio/capture.js';
import { updateKeyDisplay } from './ui/key-display.js';
import { updateFingerboard } from './ui/fingerboard.js';
import { detectionToNoteSafety } from './detection/note-safety-aggregator.js';
import { DEFAULT_DETECTOR_ID } from './detection/factory.js';

console.log('Fiddlekey app started');

const MIN_SETTLED_AUDIO_MS = 10_000;

const startButton = document.getElementById('startButton');
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
      detectorId: DEFAULT_DETECTOR_ID,
      onMessage: handleWorkerMessage
    });
    isAnalyzing = true;

    // Ensure AudioContext is resumed (browser security requirement)
    if (audioState.audioContext.state === 'suspended') {
      await audioState.audioContext.resume();
    }

    // UI advances on worker events: download_progress -> detector_ready
    // (Analyzing...) -> detection_update. Until then it shows "Initializing...".
    console.log('Audio pipeline active');
  } catch (error) {
    console.error('Permission denied or error:', error);

    await resetAnalysisState({ clearResults: true });

    if (errorMessage) {
      errorMessage.textContent = 'Error: Microphone access is required. Please check your browser permissions.';
    }
  }
}

async function handleWorkerMessage(event) {
  const data = event.data;

  if (data.type === 'download_progress') {
    setDownloadingUI(data.loaded, data.total);
  } else if (data.type === 'detector_ready') {
    setAnalyzingUI(true, 'Analyzing...');
  } else if (data.type === 'detection_update') {
    if (data.detection) {
      bestDetection = data.detection;
      window.dispatchEvent(new CustomEvent('fiddlekey:detection', { detail: data.detection }));

      if ((data.audioProcessedMs ?? 0) >= MIN_SETTLED_AUDIO_MS) {
        await showSettledNotes(bestDetection);
      }
    }
  } else if (data.type === 'detector_error') {
    if (errorMessage) {
      errorMessage.textContent = `Error: Failed to initialize detector ${data.detectorId}: ${data.message || 'Unknown error'}.`;
    }
    await resetAnalysisState({ clearResults: true });
  }
}

async function showSettledNotes(detection) {
  if (!isAnalyzing || !detection) return;

  isAnalyzing = false;
  // Product output = safe/careful notes, not a key label. UI must not read
  // tonic/mode (IMPLEMENTATION.md Phase 3); key badge is status/debug only.
  const noteSafety = detectionToNoteSafety(detection);
  updateFingerboard(noteSafety);
  updateKeyDisplay(noteSafety);
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

function setDownloadingUI(loaded, total) {
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
  const totalMb = total > 0 ? (total / (1024 * 1024)).toFixed(1) : null;

  if (startButton) {
    startButton.disabled = true;
    startButton.textContent = pct !== null ? `Downloading ${pct}%` : 'Downloading…';
  }

  if (!keyDisplayContainer) return;

  // Downloading, not yet listening to the mic for a key.
  keyDisplayContainer.classList.add('is-analyzing');
  keyDisplayContainer.classList.remove('is-listening');

  const keyBadge = keyDisplayContainer.querySelector('.key-badge');
  const status = keyDisplayContainer.querySelector('.analysis-status');
  const confidenceBar = keyDisplayContainer.querySelector('.confidence-fill');

  if (keyBadge) keyBadge.textContent = 'Downloading…';
  if (status) {
    status.textContent = totalMb
      ? `Downloading detector model… ${loadedMb} / ${totalMb} MB`
      : `Downloading detector model… ${loadedMb} MB`;
  }
  if (confidenceBar) {
    if (pct !== null) {
      // Determinate progress bar.
      confidenceBar.style.width = `${pct}%`;
      confidenceBar.className = 'confidence-fill status-high';
    } else {
      confidenceBar.style.width = '100%';
      confidenceBar.className = 'confidence-fill status-analyzing';
    }
  }
}

function setAnalyzingUI(analyzing, text = '') {
  if (startButton) {
    startButton.disabled = analyzing;
    startButton.textContent = analyzing ? (text || 'Analyzing...') : 'Detect notes';
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
  updateFingerboard(null);
}
