document.documentElement.classList.add("js");

const tabs = Array.from(document.querySelectorAll("[data-result-tab]"));
const panels = Array.from(document.querySelectorAll("[data-result-panel]"));

function activateResult(tab) {
  const resultId = tab.dataset.resultTab;

  tabs.forEach((candidate) => {
    const isActive = candidate === tab;
    candidate.setAttribute("aria-selected", String(isActive));
    candidate.tabIndex = isActive ? 0 : -1;
  });

  panels.forEach((panel) => {
    panel.hidden = panel.dataset.resultPanel !== resultId;
  });
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateResult(tab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;

    tabs[nextIndex].focus();
    activateResult(tabs[nextIndex]);
  });
});

const demoRoot = document.querySelector("[data-foj-demo]");

if (demoRoot) {
  const VOLUME_SIZE = 256;
  const DISPLAY_SIZE = 512;
  const CHANNEL_SIZE = VOLUME_SIZE ** 3;
  const axisColors = {
    x: "#e07a72",
    y: "#73b487",
    z: "#719ed5"
  };
  const methodLabels = {
    input: "noise-free engine CT",
    foj: "3D FoJ junction regions",
    boundary: "3D FoJ global boundary map"
  };
  const noiseLevels = {
    clean: {
      label: "Clean",
      title: "Clean reference",
      inputTitle: "Noise-free CT",
      inputMeta: "Clean reference",
      fojMeta: "28.99 dB vs clean",
      description: "No added noise; the experiment volume is shown as the reference state.",
      file: "static/data/junction-lab-256.bin.gz?v=poisson-sweep-20260828"
    },
    p100: {
      label: "P100",
      title: "P100 · mild noise",
      inputTitle: "P100 noisy CT",
      inputMeta: "29.26 dB · 100 photons",
      fojMeta: "28.86 dB · −0.40",
      description: "Mild P100 Poisson noise. The fixed FoJ setting prioritizes the structural representation rather than tuning for this individual level.",
      file: "static/data/engine-ct-p100-256.bin.gz?v=poisson-sweep-20260828"
    },
    p50: {
      label: "P50",
      title: "P50 · moderate noise",
      inputTitle: "P50 noisy CT",
      inputMeta: "26.27 dB · 50 photons",
      fojMeta: "28.77 dB · +2.50",
      description: "Moderate P50 Poisson noise. The same fixed FoJ setting improves the fitted-support PSNR by 2.50 dB.",
      file: "static/data/engine-ct-p50-256.bin.gz?v=poisson-sweep-20260828"
    },
    p20: {
      label: "P20",
      title: "P20 · severe noise",
      inputTitle: "P20 noisy CT",
      inputMeta: "22.39 dB · 20 photons",
      fojMeta: "28.51 dB · +6.12",
      description: "Severe P20 Poisson noise. The same fixed FoJ setting improves the fitted-support PSNR by 6.12 dB.",
      file: "static/data/engine-ct-p20-256.bin.gz?v=poisson-sweep-20260828"
    }
  };

  const views = Array.from(demoRoot.querySelectorAll("[data-demo-view]"));
  const status = demoRoot.querySelector("[data-demo-status]");
  const matrix = demoRoot.querySelector("[data-demo-matrix]");
  const noiseButtons = Array.from(demoRoot.querySelectorAll("[data-demo-noise]"));
  const noiseTitle = demoRoot.querySelector("[data-demo-noise-title]");
  const noiseDescription = demoRoot.querySelector("[data-demo-noise-description]");
  const inputTitle = demoRoot.querySelector("[data-demo-input-title]");
  const inputMeta = demoRoot.querySelector("[data-demo-input-meta]");
  const fojMeta = demoRoot.querySelector("[data-demo-foj-meta]");
  const inputCaptions = Array.from(demoRoot.querySelectorAll("[data-demo-input-caption]"));
  const sliders = Object.fromEntries(
    Array.from(demoRoot.querySelectorAll("[data-demo-axis-slider]")).map((slider) => [slider.dataset.demoAxisSlider, slider])
  );
  const sliderOutputs = Object.fromEntries(
    Array.from(demoRoot.querySelectorAll("[data-demo-axis-output]")).map((output) => [output.dataset.demoAxisOutput, output])
  );
  const coordinateOutputs = {
    x: demoRoot.querySelector("[data-demo-x]"),
    y: demoRoot.querySelector("[data-demo-y]"),
    z: demoRoot.querySelector("[data-demo-z]")
  };
  const planeOutputs = Object.fromEntries(
    Array.from(demoRoot.querySelectorAll("[data-demo-plane-output]")).map((output) => [output.dataset.demoPlaneOutput, output])
  );
  const state = {
    point: { x: 128, y: 128, z: 128 },
    volumes: {},
    noiseLevel: "clean",
    loadRequestId: 0,
    renderQueued: false
  };

  function clamp(value) {
    return Math.max(0, Math.min(VOLUME_SIZE - 1, Math.round(value)));
  }

  function volumeIndex(x, y, z) {
    return z * VOLUME_SIZE * VOLUME_SIZE + y * VOLUME_SIZE + x;
  }

  function sample(volume, x, y, z) {
    return volume[volumeIndex(x, y, z)];
  }

  function viewCoordinates(plane, u, v) {
    if (plane === "yz") return { x: state.point.x, y: u, z: v };
    if (plane === "xz") return { x: u, y: state.point.y, z: v };
    return { x: u, y: v, z: state.point.z };
  }

  function crosshairForPlane(plane) {
    if (plane === "yz") return { horizontal: "y", vertical: "z" };
    if (plane === "xz") return { horizontal: "x", vertical: "z" };
    return { horizontal: "x", vertical: "y" };
  }

  function fixedAxisForPlane(plane) {
    if (plane === "yz") return "x";
    if (plane === "xz") return "y";
    return "z";
  }

  function drawCrosshair(context, plane) {
    const axes = crosshairForPlane(plane);
    const displayScale = DISPLAY_SIZE / VOLUME_SIZE;
    const horizontalPosition = (state.point[axes.horizontal] + 0.5) * displayScale;
    const verticalPosition = (state.point[axes.vertical] + 0.5) * displayScale;

    context.save();
    context.lineWidth = 2;
    context.shadowColor = "rgba(0, 0, 0, 0.75)";
    context.shadowBlur = 3;

    context.strokeStyle = axisColors[axes.horizontal];
    context.beginPath();
    context.moveTo(horizontalPosition, 0);
    context.lineTo(horizontalPosition, DISPLAY_SIZE);
    context.stroke();

    context.strokeStyle = axisColors[axes.vertical];
    context.beginPath();
    context.moveTo(0, verticalPosition);
    context.lineTo(DISPLAY_SIZE, verticalPosition);
    context.stroke();

    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(horizontalPosition, verticalPosition, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawView(canvas) {
    const volume = state.volumes[canvas.dataset.demoMethod];
    if (!volume) return;

    const plane = canvas.dataset.demoView;
    const context = canvas.getContext("2d");
    const sliceCanvas = canvas._sliceCanvas || document.createElement("canvas");
    if (!canvas._sliceCanvas) {
      sliceCanvas.width = VOLUME_SIZE;
      sliceCanvas.height = VOLUME_SIZE;
      canvas._sliceCanvas = sliceCanvas;
      canvas._sliceContext = sliceCanvas.getContext("2d");
    }
    const sliceContext = canvas._sliceContext;
    const image = canvas._sliceImage || sliceContext.createImageData(VOLUME_SIZE, VOLUME_SIZE);
    canvas._sliceImage = image;

    for (let v = 0; v < VOLUME_SIZE; v += 1) {
      for (let u = 0; u < VOLUME_SIZE; u += 1) {
        const voxel = viewCoordinates(plane, u, v);
        const value = sample(volume, voxel.x, voxel.y, voxel.z);
        const pixel = (v * VOLUME_SIZE + u) * 4;
        image.data[pixel] = value;
        image.data[pixel + 1] = value;
        image.data[pixel + 2] = value;
        image.data[pixel + 3] = 255;
      }
    }

    sliceContext.putImageData(image, 0, 0);
    context.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(sliceCanvas, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    drawCrosshair(context, plane);

    const method = methodLabels[canvas.dataset.demoMethod] || canvas.dataset.demoMethod;
    const fixedAxis = fixedAxisForPlane(plane);
    canvas.setAttribute(
      "aria-label",
      `${method} ${plane.toUpperCase()} view at ${fixedAxis} ${state.point[fixedAxis]}. Linked voxel x ${state.point.x}, y ${state.point.y}, z ${state.point.z}.`
    );
  }

  function updateLabels() {
    Object.keys(state.point).forEach((axis) => {
      const value = state.point[axis];
      sliders[axis].value = String(value);
      sliderOutputs[axis].textContent = String(value);
      coordinateOutputs[axis].textContent = String(value);
    });
    planeOutputs.xy.textContent = `z = ${state.point.z}`;
    planeOutputs.yz.textContent = `x = ${state.point.x}`;
    planeOutputs.xz.textContent = `y = ${state.point.y}`;
  }

  function render() {
    state.renderQueued = false;
    updateLabels();
    views.forEach(drawView);
  }

  function scheduleRender() {
    if (state.renderQueued) return;
    state.renderQueued = true;
    window.requestAnimationFrame(render);
  }

  function setPoint(nextPoint) {
    state.point = {
      x: clamp(nextPoint.x),
      y: clamp(nextPoint.y),
      z: clamp(nextPoint.z)
    };
    scheduleRender();
  }

  function updatePointFromPointer(canvas, event) {
    if (!state.volumes[canvas.dataset.demoMethod]) return;
    const bounds = canvas.getBoundingClientRect();
    const u = clamp(((event.clientX - bounds.left) / bounds.width) * VOLUME_SIZE);
    const v = clamp(((event.clientY - bounds.top) / bounds.height) * VOLUME_SIZE);
    const plane = canvas.dataset.demoView;
    const nextPoint = { ...state.point };

    if (plane === "yz") {
      nextPoint.y = u;
      nextPoint.z = v;
    } else if (plane === "xz") {
      nextPoint.x = u;
      nextPoint.z = v;
    } else {
      nextPoint.x = u;
      nextPoint.y = v;
    }
    setPoint(nextPoint);
  }

  function moveWithinPlane(canvas, horizontalDelta, verticalDelta) {
    const axes = crosshairForPlane(canvas.dataset.demoView);
    setPoint({
      ...state.point,
      [axes.horizontal]: state.point[axes.horizontal] + horizontalDelta,
      [axes.vertical]: state.point[axes.vertical] + verticalDelta
    });
  }

  function updateNoiseLabels(levelKey) {
    const config = noiseLevels[levelKey];
    noiseButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.demoNoise === levelKey));
    });
    noiseTitle.textContent = config.title;
    noiseDescription.textContent = config.description;
    inputTitle.textContent = config.inputTitle;
    inputMeta.textContent = config.inputMeta;
    fojMeta.textContent = config.fojMeta;
    inputCaptions.forEach((caption) => {
      caption.textContent = config.inputTitle;
    });
    methodLabels.input = `${config.label} engine CT input`;
    methodLabels.foj = `${config.label} 3D FoJ junction regions`;
    methodLabels.boundary = `${config.label} 3D FoJ global boundary map`;
  }

  async function loadVolume(levelKey) {
    const config = noiseLevels[levelKey];
    status.textContent = `Loading ${config.label} input, junction regions, and boundaries…`;
    const response = await fetch(config.file);
    if (!response.ok) throw new Error("Could not load the junction demo volume");
    if (!("DecompressionStream" in window) || !response.body) {
      throw new Error("This browser cannot decode the compressed junction demo volume");
    }
    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(decompressed).arrayBuffer());
    if (bytes.length !== CHANNEL_SIZE * 3) throw new Error("Unexpected junction demo volume size");
    return {
      input: bytes.subarray(0, CHANNEL_SIZE),
      foj: bytes.subarray(CHANNEL_SIZE, CHANNEL_SIZE * 2),
      boundary: bytes.subarray(CHANNEL_SIZE * 2)
    };
  }

  async function activateNoiseLevel(levelKey) {
    if (!noiseLevels[levelKey]) return;
    if (levelKey === state.noiseLevel && state.volumes.input) {
      if (demoRoot.getAttribute("aria-busy") === "true") {
        state.loadRequestId += 1;
        updateNoiseLabels(levelKey);
        status.textContent = "";
        demoRoot.setAttribute("aria-busy", "false");
        render();
      }
      return;
    }

    const requestId = state.loadRequestId + 1;
    const previousLevel = state.noiseLevel;
    state.loadRequestId = requestId;
    updateNoiseLabels(levelKey);
    demoRoot.setAttribute("aria-busy", "true");

    try {
      const volumes = await loadVolume(levelKey);
      if (requestId !== state.loadRequestId) return;
      state.noiseLevel = levelKey;
      state.volumes = volumes;
      status.textContent = "";
      demoRoot.setAttribute("aria-busy", "false");
      matrix.removeAttribute("aria-hidden");
      render();
    } catch (error) {
      if (requestId !== state.loadRequestId) return;
      console.error(error);
      updateNoiseLabels(previousLevel);
      status.textContent = `${noiseLevels[levelKey].label} could not be loaded. Try again.`;
      demoRoot.setAttribute("aria-busy", "false");
    }
  }

  Object.entries(sliders).forEach(([axis, slider]) => {
    slider.addEventListener("input", () => {
      setPoint({ ...state.point, [axis]: Number(slider.value) });
    });
  });

  noiseButtons.forEach((button) => {
    button.addEventListener("click", () => activateNoiseLevel(button.dataset.demoNoise));
  });

  views.forEach((canvas) => {
    canvas.addEventListener("pointermove", (event) => updatePointFromPointer(canvas, event));
    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      canvas.setPointerCapture?.(event.pointerId);
      updatePointFromPointer(canvas, event);
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const fixedAxis = fixedAxisForPlane(canvas.dataset.demoView);
        setPoint({ ...state.point, [fixedAxis]: state.point[fixedAxis] + Math.sign(event.deltaY) });
      },
      { passive: false }
    );
    canvas.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") moveWithinPlane(canvas, -1, 0);
      if (event.key === "ArrowRight") moveWithinPlane(canvas, 1, 0);
      if (event.key === "ArrowUp") moveWithinPlane(canvas, 0, -1);
      if (event.key === "ArrowDown") moveWithinPlane(canvas, 0, 1);
      if (event.key === "PageUp" || event.key === "PageDown") {
        const fixedAxis = fixedAxisForPlane(canvas.dataset.demoView);
        setPoint({ ...state.point, [fixedAxis]: state.point[fixedAxis] + (event.key === "PageUp" ? 1 : -1) });
      }
    });
  });

  async function initializeDemo() {
    await activateNoiseLevel("clean");
  }

  updateLabels();
  initializeDemo();
}

const copyButton = document.querySelector("#copy-bibtex");
const copyStatus = document.querySelector("#copy-status");
const bibtexEntry = document.querySelector("#bibtex-entry");

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

copyButton?.addEventListener("click", async () => {
  try {
    await copyText(bibtexEntry.textContent.trim());
    copyStatus.textContent = "Copied";
    copyButton.textContent = "Copied";
  } catch {
    copyStatus.textContent = "Select the text below";
  }

  window.setTimeout(() => {
    copyStatus.textContent = "";
    copyButton.textContent = "Copy";
  }, 2200);
});

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}
