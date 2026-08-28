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
  const VOLUME_SIZE = 64;
  const DISPLAY_SIZE = 512;
  const CHANNEL_SIZE = VOLUME_SIZE ** 3;
  const axisColors = {
    x: "#e07a72",
    y: "#73b487",
    z: "#719ed5"
  };
  const methodLabels = {
    input: "P5 noisy input",
    foj: "3D FoJ",
    gt: "ground truth"
  };

  const views = Array.from(demoRoot.querySelectorAll("[data-demo-view]"));
  const status = demoRoot.querySelector("[data-demo-status]");
  const matrix = demoRoot.querySelector("[data-demo-matrix]");
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
    point: { x: 32, y: 32, z: 32 },
    volumes: {},
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

  async function loadVolume() {
    status.textContent = "Loading noisy input, 3D FoJ, and clean reference…";
    const response = await fetch("static/data/junction-lab.bin");
    if (!response.ok) throw new Error("Could not load the junction demo volume");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== CHANNEL_SIZE * 3) throw new Error("Unexpected junction demo volume size");
    state.volumes = {
      input: bytes.subarray(0, CHANNEL_SIZE),
      foj: bytes.subarray(CHANNEL_SIZE, CHANNEL_SIZE * 2),
      gt: bytes.subarray(CHANNEL_SIZE * 2)
    };
  }

  Object.entries(sliders).forEach(([axis, slider]) => {
    slider.addEventListener("input", () => {
      setPoint({ ...state.point, [axis]: Number(slider.value) });
    });
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
    try {
      await loadVolume();
      status.textContent = "";
      demoRoot.setAttribute("aria-busy", "false");
      matrix.removeAttribute("aria-hidden");
      render();
    } catch (error) {
      console.error(error);
      status.textContent = "The demonstration volume could not be loaded. Please refresh the page.";
      demoRoot.setAttribute("aria-busy", "false");
    }
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
