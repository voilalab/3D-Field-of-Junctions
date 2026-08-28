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
  const ATLAS_SIZE = 4096;
  const TILES_PER_ROW = 16;
  const axisColors = {
    x: "#e07a72",
    y: "#73b487",
    z: "#719ed5"
  };
  const sources = [
    { method: "cgls", label: "CGLS", file: "static/data/engine-p50-cgls.webp" },
    { method: "foj", label: "3D FoJ", file: "static/data/engine-p50-foj.webp" },
    { method: "gt", label: "ground truth", file: "static/data/engine-ground-truth.webp" }
  ];

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
    point: { x: 128, y: 128, z: 96 },
    atlases: {},
    renderQueued: false
  };

  function clamp(value) {
    return Math.max(0, Math.min(VOLUME_SIZE - 1, Math.round(value)));
  }

  function atlasIndex(x, y, z) {
    const atlasRow = Math.floor(z / TILES_PER_ROW) * VOLUME_SIZE + y;
    const atlasColumn = (z % TILES_PER_ROW) * VOLUME_SIZE + x;
    return atlasRow * ATLAS_SIZE + atlasColumn;
  }

  function sample(atlas, x, y, z) {
    return atlas[atlasIndex(x, y, z)];
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
    const horizontalPosition = state.point[axes.horizontal] + 0.5;
    const verticalPosition = state.point[axes.vertical] + 0.5;

    context.save();
    context.lineWidth = 1.25;
    context.shadowColor = "rgba(0, 0, 0, 0.75)";
    context.shadowBlur = 2;

    context.strokeStyle = axisColors[axes.horizontal];
    context.beginPath();
    context.moveTo(horizontalPosition, 0);
    context.lineTo(horizontalPosition, VOLUME_SIZE);
    context.stroke();

    context.strokeStyle = axisColors[axes.vertical];
    context.beginPath();
    context.moveTo(0, verticalPosition);
    context.lineTo(VOLUME_SIZE, verticalPosition);
    context.stroke();

    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(horizontalPosition, verticalPosition, 2.3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawView(canvas) {
    const atlas = state.atlases[canvas.dataset.demoMethod];
    if (!atlas) return;

    const plane = canvas.dataset.demoView;
    const context = canvas.getContext("2d");
    const image = canvas._sliceImage || context.createImageData(VOLUME_SIZE, VOLUME_SIZE);
    canvas._sliceImage = image;

    for (let v = 0; v < VOLUME_SIZE; v += 1) {
      for (let u = 0; u < VOLUME_SIZE; u += 1) {
        const voxel = viewCoordinates(plane, u, v);
        const value = sample(atlas, voxel.x, voxel.y, voxel.z);
        const pixel = (v * VOLUME_SIZE + u) * 4;
        image.data[pixel] = value;
        image.data[pixel + 1] = value;
        image.data[pixel + 2] = value;
        image.data[pixel + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    drawCrosshair(context, plane);

    const method = sources.find((source) => source.method === canvas.dataset.demoMethod)?.label || canvas.dataset.demoMethod;
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
    if (!state.atlases[canvas.dataset.demoMethod]) return;
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

  async function loadAtlas(source, index) {
    status.textContent = `Loading ${source.label} volume · ${index + 1} / ${sources.length}…`;
    const image = new Image();
    image.decoding = "async";
    image.src = source.file;
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error(`Could not load ${source.file}`)), { once: true });
    });

    const atlasCanvas = document.createElement("canvas");
    atlasCanvas.width = ATLAS_SIZE;
    atlasCanvas.height = ATLAS_SIZE;
    const atlasContext = atlasCanvas.getContext("2d", { willReadFrequently: true });
    atlasContext.drawImage(image, 0, 0);
    const rgba = atlasContext.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;
    const grayscale = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);

    for (let pixel = 0; pixel < grayscale.length; pixel += 1) {
      grayscale[pixel] = rgba[pixel * 4];
    }

    atlasCanvas.width = 1;
    atlasCanvas.height = 1;
    state.atlases[source.method] = grayscale;
    scheduleRender();
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
      for (let index = 0; index < sources.length; index += 1) {
        await loadAtlas(sources[index], index);
      }
      status.textContent = "";
      demoRoot.setAttribute("aria-busy", "false");
      matrix.removeAttribute("aria-hidden");
      render();
    } catch (error) {
      console.error(error);
      status.textContent = "The experiment volume could not be loaded. Please refresh the page.";
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
