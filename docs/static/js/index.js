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
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

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
  const VOLUME_SIZE = 26;
  const CHANNEL_SIZE = VOLUME_SIZE ** 3;
  const PATCH_RADIUS = 4;
  const GOLD = [192, 153, 94];
  const examples = {
    "sharp-corner": {
      title: "Sharp corner",
      file: "static/data/sharp-corner.bin",
      description: "Three intersecting surfaces meet at one volumetric corner. Move across the junction to compare the noisy voxels with the locally fitted wedge structure."
    },
    "bent-boundary": {
      title: "Bent boundary",
      file: "static/data/bent-boundary.bin",
      description: "The junction vertex sits close to the volume boundary, producing a bent interface that changes character across the three orthogonal views."
    },
    "planar-edge": {
      title: "Planar edge",
      file: "static/data/planar-edge.bin",
      description: "A simpler two-region interface shows how overlapping 3D junction patches preserve a clean plane despite severe low-photon noise."
    },
    "engine-ct": {
      title: "Engine CT",
      file: "static/data/engine-ct.bin",
      description: "A real engine CT crop from the paper data. Inspect the thin material boundaries and internal cavities in all three orientations."
    }
  };

  const mainCanvas = demoRoot.querySelector("[data-demo-main]");
  const mainContext = mainCanvas.getContext("2d");
  const scratchCanvas = document.createElement("canvas");
  const scratchContext = scratchCanvas.getContext("2d");
  scratchCanvas.width = VOLUME_SIZE;
  scratchCanvas.height = VOLUME_SIZE;

  const patchCanvases = Object.fromEntries(
    Array.from(demoRoot.querySelectorAll("[data-demo-patch]")).map((canvas) => [canvas.dataset.demoPatch, canvas])
  );
  const exampleButtons = Array.from(demoRoot.querySelectorAll("[data-demo-example]"));
  const axisButtons = Array.from(demoRoot.querySelectorAll("[data-demo-axis]"));
  const sliceInput = demoRoot.querySelector("[data-demo-slice]");
  const sliceOutput = demoRoot.querySelector("[data-demo-slice-output]");
  const boundaryButton = demoRoot.querySelector("[data-demo-boundary]");
  const boundaryButtonTitle = boundaryButton.querySelector("strong");
  const status = demoRoot.querySelector("[data-demo-status]");
  const title = demoRoot.querySelector("[data-demo-title]");
  const viewLabel = demoRoot.querySelector("[data-demo-view-label]");
  const description = demoRoot.querySelector("[data-demo-description]");
  const coordinateLabels = {
    x: demoRoot.querySelector("[data-demo-x]"),
    y: demoRoot.querySelector("[data-demo-y]"),
    z: demoRoot.querySelector("[data-demo-z]")
  };

  const cache = new Map();
  const state = {
    example: "sharp-corner",
    axis: "xy",
    slice: 13,
    point: { x: 13, y: 13, z: 13 },
    volume: null,
    overlayPinned: false,
    spaceHeld: false,
    loadToken: 0
  };

  function volumeIndex(x, y, z) {
    return z * VOLUME_SIZE * VOLUME_SIZE + y * VOLUME_SIZE + x;
  }

  function clampVoxel(value) {
    return Math.max(0, Math.min(VOLUME_SIZE - 1, value));
  }

  function displayToVoxel(u, v) {
    if (state.axis === "yz") return { x: state.slice, y: u, z: v };
    if (state.axis === "xz") return { x: u, y: state.slice, z: v };
    return { x: u, y: v, z: state.slice };
  }

  function voxelToDisplay(point = state.point) {
    if (state.axis === "yz") return { u: point.y, v: point.z };
    if (state.axis === "xz") return { u: point.x, v: point.z };
    return { u: point.x, v: point.y };
  }

  function sample(channel, u, v) {
    const voxel = displayToVoxel(clampVoxel(u), clampVoxel(v));
    return state.volume[channel][volumeIndex(voxel.x, voxel.y, voxel.z)];
  }

  function drawSlice() {
    if (!state.volume) return;
    const image = scratchContext.createImageData(VOLUME_SIZE, VOLUME_SIZE);
    const showBoundary = state.overlayPinned || state.spaceHeld;

    for (let v = 0; v < VOLUME_SIZE; v += 1) {
      for (let u = 0; u < VOLUME_SIZE; u += 1) {
        const imageIndex = (v * VOLUME_SIZE + u) * 4;
        const base = sample("input", u, v);
        let red = base;
        let green = base;
        let blue = base;

        if (showBoundary) {
          const boundary = sample("boundary", u, v) / 255;
          const alpha = Math.min(0.92, boundary * 1.45);
          red = Math.round(base * (1 - alpha) + GOLD[0] * alpha);
          green = Math.round(base * (1 - alpha) + GOLD[1] * alpha);
          blue = Math.round(base * (1 - alpha) + GOLD[2] * alpha);
        }

        image.data[imageIndex] = red;
        image.data[imageIndex + 1] = green;
        image.data[imageIndex + 2] = blue;
        image.data[imageIndex + 3] = 255;
      }
    }

    scratchContext.putImageData(image, 0, 0);
    mainContext.imageSmoothingEnabled = false;
    mainContext.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainContext.drawImage(scratchCanvas, 0, 0, mainCanvas.width, mainCanvas.height);

    const { u, v } = voxelToDisplay();
    const scale = mainCanvas.width / VOLUME_SIZE;
    const patchStart = Math.max(0, u - PATCH_RADIUS);
    const patchEnd = Math.min(VOLUME_SIZE, u + PATCH_RADIUS + 1);
    const patchTop = Math.max(0, v - PATCH_RADIUS);
    const patchBottom = Math.min(VOLUME_SIZE, v + PATCH_RADIUS + 1);

    mainContext.save();
    mainContext.strokeStyle = "rgba(255, 255, 255, 0.85)";
    mainContext.lineWidth = 1;
    mainContext.beginPath();
    mainContext.moveTo((u + 0.5) * scale, 0);
    mainContext.lineTo((u + 0.5) * scale, mainCanvas.height);
    mainContext.moveTo(0, (v + 0.5) * scale);
    mainContext.lineTo(mainCanvas.width, (v + 0.5) * scale);
    mainContext.stroke();
    mainContext.strokeStyle = `rgb(${GOLD.join(", ")})`;
    mainContext.lineWidth = 3;
    mainContext.strokeRect(
      patchStart * scale + 1.5,
      patchTop * scale + 1.5,
      (patchEnd - patchStart) * scale - 3,
      (patchBottom - patchTop) * scale - 3
    );
    mainContext.restore();
  }

  function drawPatch(channel, canvas) {
    if (!state.volume || !canvas) return;
    const patchSize = PATCH_RADIUS * 2 + 1;
    const buffer = document.createElement("canvas");
    buffer.width = patchSize;
    buffer.height = patchSize;
    const bufferContext = buffer.getContext("2d");
    const image = bufferContext.createImageData(patchSize, patchSize);
    const center = voxelToDisplay();

    for (let patchV = 0; patchV < patchSize; patchV += 1) {
      for (let patchU = 0; patchU < patchSize; patchU += 1) {
        const u = center.u + patchU - PATCH_RADIUS;
        const v = center.v + patchV - PATCH_RADIUS;
        const value = sample(channel, u, v);
        const imageIndex = (patchV * patchSize + patchU) * 4;

        if (channel === "boundary") {
          const strength = value / 255;
          image.data[imageIndex] = Math.round(GOLD[0] * strength);
          image.data[imageIndex + 1] = Math.round(GOLD[1] * strength);
          image.data[imageIndex + 2] = Math.round(GOLD[2] * strength);
        } else {
          image.data[imageIndex] = value;
          image.data[imageIndex + 1] = value;
          image.data[imageIndex + 2] = value;
        }
        image.data[imageIndex + 3] = 255;
      }
    }

    bufferContext.putImageData(image, 0, 0);
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255, 255, 255, 0.72)";
    context.lineWidth = 2;
    const cell = canvas.width / patchSize;
    context.strokeRect(PATCH_RADIUS * cell + 1, PATCH_RADIUS * cell + 1, cell - 2, cell - 2);
  }

  function updateLabels() {
    const fixedAxis = state.axis === "xy" ? "z" : state.axis === "yz" ? "x" : "y";
    const orientation = state.axis === "xy" ? "XY · axial" : state.axis === "yz" ? "YZ · sagittal" : "XZ · coronal";
    viewLabel.textContent = `${orientation} · ${fixedAxis} = ${state.slice}`;
    sliceOutput.textContent = `${state.slice} / ${VOLUME_SIZE - 1}`;
    sliceInput.value = String(state.slice);
    Object.entries(coordinateLabels).forEach(([axis, element]) => {
      element.textContent = String(state.point[axis]);
    });
    mainCanvas.setAttribute(
      "aria-label",
      `Interactive ${orientation.toLowerCase()} slice ${state.slice}. Selected voxel x ${state.point.x}, y ${state.point.y}, z ${state.point.z}.`
    );
  }

  function renderDemo() {
    if (!state.volume) return;
    updateLabels();
    drawSlice();
    Object.entries(patchCanvases).forEach(([channel, canvas]) => drawPatch(channel, canvas));
  }

  function setSlice(value) {
    state.slice = clampVoxel(Number(value));
    if (state.axis === "xy") state.point.z = state.slice;
    if (state.axis === "yz") state.point.x = state.slice;
    if (state.axis === "xz") state.point.y = state.slice;
    renderDemo();
  }

  function setAxis(axis) {
    state.axis = axis;
    if (axis === "xy") state.slice = state.point.z;
    if (axis === "yz") state.slice = state.point.x;
    if (axis === "xz") state.slice = state.point.y;
    axisButtons.forEach((button) => {
      const isActive = button.dataset.demoAxis === axis;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    renderDemo();
  }

  function setPointerPosition(event) {
    if (!state.volume) return;
    const bounds = mainCanvas.getBoundingClientRect();
    const u = clampVoxel(Math.floor(((event.clientX - bounds.left) / bounds.width) * VOLUME_SIZE));
    const v = clampVoxel(Math.floor(((event.clientY - bounds.top) / bounds.height) * VOLUME_SIZE));
    state.point = displayToVoxel(u, v);
    renderDemo();
  }

  async function fetchVolume(example) {
    if (cache.has(example.file)) return cache.get(example.file);
    const response = await fetch(example.file);
    if (!response.ok) throw new Error(`Could not load ${example.file}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== CHANNEL_SIZE * 3) throw new Error("Unexpected demo volume size");
    const volume = {
      input: bytes.subarray(0, CHANNEL_SIZE),
      fit: bytes.subarray(CHANNEL_SIZE, CHANNEL_SIZE * 2),
      boundary: bytes.subarray(CHANNEL_SIZE * 2)
    };
    cache.set(example.file, volume);
    return volume;
  }

  async function loadExample(slug) {
    const example = examples[slug];
    if (!example) return;
    const loadToken = state.loadToken + 1;
    state.loadToken = loadToken;
    state.example = slug;
    title.textContent = example.title;
    description.textContent = example.description;
    status.textContent = `Loading ${example.title}…`;
    demoRoot.setAttribute("aria-busy", "true");
    exampleButtons.forEach((button) => {
      const isActive = button.dataset.demoExample === slug;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    try {
      const volume = await fetchVolume(example);
      if (loadToken !== state.loadToken) return;
      state.volume = volume;
      state.point = { x: 13, y: 13, z: 13 };
      state.slice = 13;
      status.textContent = "";
      demoRoot.setAttribute("aria-busy", "false");
      renderDemo();
    } catch (error) {
      if (loadToken !== state.loadToken) return;
      console.error(error);
      status.textContent = "Demo data could not be loaded. Please refresh the page.";
      demoRoot.setAttribute("aria-busy", "false");
    }
  }

  exampleButtons.forEach((button) => {
    button.addEventListener("click", () => loadExample(button.dataset.demoExample));
  });
  axisButtons.forEach((button) => {
    button.addEventListener("click", () => setAxis(button.dataset.demoAxis));
  });
  sliceInput.addEventListener("input", () => setSlice(sliceInput.value));
  mainCanvas.addEventListener("pointermove", setPointerPosition);
  mainCanvas.addEventListener("pointerdown", (event) => {
    mainCanvas.focus();
    setPointerPosition(event);
  });
  boundaryButton.addEventListener("click", () => {
    state.overlayPinned = !state.overlayPinned;
    boundaryButton.setAttribute("aria-pressed", String(state.overlayPinned));
    boundaryButtonTitle.textContent = state.overlayPinned ? "Hide global boundaries" : "Show global boundaries";
    renderDemo();
  });

  document.addEventListener("keydown", (event) => {
    const activeInDemo = demoRoot.contains(document.activeElement);
    const isEditable = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
    if (event.code === "Space" && activeInDemo && !isEditable) {
      event.preventDefault();
      if (!state.spaceHeld) {
        state.spaceHeld = true;
        renderDemo();
      }
    }
    if (!activeInDemo || isEditable) return;
    if (event.key === "1") setAxis("xy");
    if (event.key === "2") setAxis("yz");
    if (event.key === "3") setAxis("xz");
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setSlice(state.slice + (event.key === "ArrowRight" ? 1 : -1));
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "Space" || !state.spaceHeld) return;
    state.spaceHeld = false;
    renderDemo();
  });

  loadExample(state.example);
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
