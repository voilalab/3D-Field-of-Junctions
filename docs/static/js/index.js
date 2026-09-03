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
  const volumeCanvas = demoRoot.querySelector("[data-demo-volume]");
  const volumeStatus = demoRoot.querySelector("[data-demo-volume-status]");
  const volumeTitle = demoRoot.querySelector("[data-demo-volume-title]");
  const inputVolumeCanvas = demoRoot.querySelector("[data-demo-input-volume]");
  const inputVolumeStatus = demoRoot.querySelector("[data-demo-input-volume-status]");
  const inputVolumeTitle = demoRoot.querySelector("[data-demo-input-volume-title]");
  const inputVolumeError = demoRoot.querySelector("[data-demo-volume-error]");
  const volumeReset = demoRoot.querySelector("[data-demo-volume-reset]");
  const volumeCut = demoRoot.querySelector("[data-demo-volume-cut]");
  const volumeCutOutput = demoRoot.querySelector("[data-demo-volume-cut-output]");
  const volumeThreshold = demoRoot.querySelector("[data-demo-volume-threshold]");
  const volumeThresholdOutput = demoRoot.querySelector("[data-demo-volume-threshold-output]");
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

  function createVolumeRenderer(canvas, statusElement, bindControls = false) {
    const unavailable = {
      setLoading() {},
      setVolume() {},
      setComparisonVolume() {},
      setErrorMode() {},
      setViewState() {},
      onViewChange() {},
      render() {}
    };
    if (!canvas) return unavailable;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      powerPreference: "high-performance"
    });
    if (!gl) {
      statusElement.textContent = "WebGL 2 is required for the 3D view.";
      return unavailable;
    }

    const vertexSource = `#version 300 es
      layout(location = 0) in vec2 a_position;
      out vec2 v_uv;

      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `#version 300 es
      precision highp float;
      precision highp sampler3D;

      in vec2 v_uv;
      uniform sampler3D u_volume;
      uniform sampler3D u_comparison;
      uniform vec2 u_rotation;
      uniform float u_cut;
      uniform float u_threshold;
      uniform float u_aspect;
      uniform int u_error_mode;
      out vec4 out_color;

      vec3 rotate_x(vec3 point, float angle) {
        float sine = sin(angle);
        float cosine = cos(angle);
        return vec3(point.x, cosine * point.y - sine * point.z, sine * point.y + cosine * point.z);
      }

      vec3 rotate_y(vec3 point, float angle) {
        float sine = sin(angle);
        float cosine = cos(angle);
        return vec3(cosine * point.x + sine * point.z, point.y, -sine * point.x + cosine * point.z);
      }

      vec3 view_to_volume(vec3 point) {
        return rotate_y(rotate_x(point, -u_rotation.y), -u_rotation.x);
      }

      vec2 intersect_box(vec3 origin, vec3 direction) {
        vec3 inverse_direction = 1.0 / direction;
        vec3 first = (vec3(0.0) - origin) * inverse_direction;
        vec3 second = (vec3(1.0) - origin) * inverse_direction;
        vec3 near_plane = min(first, second);
        vec3 far_plane = max(first, second);
        float near_distance = max(max(near_plane.x, near_plane.y), near_plane.z);
        float far_distance = min(min(far_plane.x, far_plane.y), far_plane.z);
        return vec2(near_distance, far_distance);
      }

      float volume_value(vec3 point) {
        return texture(u_volume, clamp(point, vec3(0.0), vec3(1.0))).r;
      }

      float comparison_value(vec3 point) {
        return texture(u_comparison, clamp(point, vec3(0.0), vec3(1.0))).r;
      }

      vec3 error_overlay(vec3 base_color, vec3 point) {
        if (u_error_mode == 0) return base_color;
        float residual = abs(volume_value(point) - comparison_value(point));
        float highlight = smoothstep(0.02, 0.14, residual);
        return mix(base_color * 0.48, vec3(0.96, 0.12, 0.08), highlight);
      }

      void main() {
        vec2 screen = v_uv * 2.0 - 1.0;
        screen.x *= u_aspect;
        screen *= 0.8;

        vec3 origin = view_to_volume(vec3(screen, -1.55)) + vec3(0.5);
        vec3 direction = normalize(view_to_volume(vec3(0.0, 0.0, 1.0)));
        vec2 hit = intersect_box(origin, direction);
        float clip_distance = 0.68 + u_cut * 1.74;
        float start_distance = max(max(hit.x, 0.0), clip_distance);

        vec3 background = mix(vec3(0.025), vec3(0.075), v_uv.y);
        if (hit.y <= start_distance) {
          out_color = vec4(background, 1.0);
          return;
        }

        float step_size = (hit.y - start_distance) / 192.0;
        vec3 point = origin + direction * (start_distance + step_size * 0.5);
        vec3 voxel = vec3(1.0 / 256.0);

        bool cut_intersects_ray = u_cut > 0.001 && clip_distance >= hit.x && clip_distance <= hit.y;
        if (cut_intersects_ray) {
          vec3 cut_point = origin + direction * clip_distance;
          float cut_value = volume_value(cut_point);
          float cut_residual = abs(cut_value - comparison_value(cut_point));
          if (cut_value > 0.018 || (u_error_mode == 1 && cut_residual > 0.02)) {
            float cut_tone = smoothstep(0.018, 0.85, cut_value);
            vec3 cut_color = mix(vec3(0.16, 0.17, 0.18), vec3(0.88, 0.74, 0.52), cut_tone);
            cut_color = error_overlay(cut_color * (0.7 + 0.3 * cut_tone), cut_point);
            out_color = vec4(cut_color, 1.0);
            return;
          }
        }

        for (int step_index = 0; step_index < 192; step_index += 1) {
          float value = volume_value(point);
          if (value >= u_threshold) {
            vec3 gradient = vec3(
              volume_value(point + vec3(voxel.x, 0.0, 0.0)) - volume_value(point - vec3(voxel.x, 0.0, 0.0)),
              volume_value(point + vec3(0.0, voxel.y, 0.0)) - volume_value(point - vec3(0.0, voxel.y, 0.0)),
              volume_value(point + vec3(0.0, 0.0, voxel.z)) - volume_value(point - vec3(0.0, 0.0, voxel.z))
            );
            vec3 normal = normalize(gradient + vec3(0.00001));
            vec3 light_direction = normalize(view_to_volume(vec3(-0.45, 0.65, -0.6)));
            float diffuse = 0.32 + 0.68 * abs(dot(normal, light_direction));
            float rim = pow(1.0 - abs(dot(normal, -direction)), 2.0);
            float material = smoothstep(u_threshold, 1.0, value);
            vec3 base = mix(vec3(0.48, 0.50, 0.53), vec3(0.83, 0.69, 0.48), material * 0.48);
            vec3 color = base * diffuse + vec3(0.24, 0.19, 0.12) * rim;
            float depth_fade = mix(1.0, 0.78, (float(step_index) / 192.0));
            color = error_overlay(color * depth_fade, point);
            out_color = vec4(color, 1.0);
            return;
          }
          point += direction * step_size;
        }

        out_color = vec4(background, 1.0);
      }
    `;

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message || "Could not compile the 3D volume shader");
      }
      return shader;
    }

    let program;
    try {
      const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Could not link the 3D volume shader");
      }
    } catch (error) {
      console.error(error);
      statusElement.textContent = "The 3D renderer could not be initialized.";
      return unavailable;
    }

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const comparisonTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, comparisonTexture);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, 1, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));

    const uniforms = {
      volume: gl.getUniformLocation(program, "u_volume"),
      comparison: gl.getUniformLocation(program, "u_comparison"),
      rotation: gl.getUniformLocation(program, "u_rotation"),
      cut: gl.getUniformLocation(program, "u_cut"),
      threshold: gl.getUniformLocation(program, "u_threshold"),
      aspect: gl.getUniformLocation(program, "u_aspect"),
      errorMode: gl.getUniformLocation(program, "u_error_mode")
    };
    const viewState = {
      yaw: -0.7,
      pitch: 0.42,
      cut: Number(volumeCut?.value || 0) / 100,
      threshold: Number(volumeThreshold?.value || 36) / 255,
      errorMode: false,
      hasVolume: false,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0
    };
    let viewChangeListener = null;

    function updateControlReadouts() {
      const cutPercentage = Math.round(viewState.cut * 100);
      volumeCut.value = String(cutPercentage);
      volumeCutOutput.textContent = `${cutPercentage}%`;
      const thresholdValue = Math.round(viewState.threshold * 255);
      volumeThreshold.value = String(thresholdValue);
      volumeThresholdOutput.textContent = String(thresholdValue);
    }

    function notifyViewChange() {
      viewChangeListener?.({
        yaw: viewState.yaw,
        pitch: viewState.pitch,
        cut: viewState.cut,
        threshold: viewState.threshold
      });
    }

    function resizeCanvas() {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.min(640, Math.round(bounds.width * pixelRatio)));
      const height = Math.max(1, Math.min(640, Math.round(bounds.height * pixelRatio)));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function renderVolume() {
      resizeCanvas();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.025, 0.025, 0.025, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!viewState.hasVolume) return;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, comparisonTexture);
      gl.uniform1i(uniforms.volume, 0);
      gl.uniform1i(uniforms.comparison, 1);
      gl.uniform2f(uniforms.rotation, viewState.yaw, viewState.pitch);
      gl.uniform1f(uniforms.cut, viewState.cut);
      gl.uniform1f(uniforms.threshold, viewState.threshold);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.uniform1i(uniforms.errorMode, viewState.errorMode ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function resetView() {
      viewState.yaw = -0.7;
      viewState.pitch = 0.42;
      viewState.cut = 0;
      updateControlReadouts();
      renderVolume();
      notifyViewChange();
    }

    function setCutDepth(nextCut) {
      viewState.cut = Math.max(0, Math.min(0.94, nextCut));
      const percentage = Math.round(viewState.cut * 100);
      volumeCut.value = String(percentage);
      volumeCutOutput.textContent = `${percentage}%`;
      renderVolume();
      notifyViewChange();
    }

    canvas.addEventListener("pointerdown", (event) => {
      viewState.dragging = true;
      viewState.pointerId = event.pointerId;
      viewState.lastX = event.clientX;
      viewState.lastY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
      canvas.focus();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!viewState.dragging || event.pointerId !== viewState.pointerId) return;
      const deltaX = event.clientX - viewState.lastX;
      const deltaY = event.clientY - viewState.lastY;
      viewState.lastX = event.clientX;
      viewState.lastY = event.clientY;
      viewState.yaw += deltaX * 0.009;
      viewState.pitch = Math.max(-1.45, Math.min(1.45, viewState.pitch + deltaY * 0.009));
      renderVolume();
      notifyViewChange();
    });
    function stopDragging(event) {
      if (event.pointerId !== viewState.pointerId) return;
      viewState.dragging = false;
      viewState.pointerId = null;
    }
    canvas.addEventListener("pointerup", stopDragging);
    canvas.addEventListener("pointercancel", stopDragging);
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        setCutDepth(viewState.cut + event.deltaY * 0.0012);
      },
      { passive: false }
    );
    canvas.addEventListener("dblclick", resetView);
    canvas.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "+", "-", "="].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") viewState.yaw -= 0.08;
      if (event.key === "ArrowRight") viewState.yaw += 0.08;
      if (event.key === "ArrowUp") viewState.pitch = Math.max(-1.45, viewState.pitch - 0.08);
      if (event.key === "ArrowDown") viewState.pitch = Math.min(1.45, viewState.pitch + 0.08);
      if (event.key === "+" || event.key === "=" || event.key === "PageDown") {
        setCutDepth(viewState.cut + 0.025);
      } else if (event.key === "-" || event.key === "PageUp") {
        setCutDepth(viewState.cut - 0.025);
      } else {
        renderVolume();
        notifyViewChange();
      }
    });
    if (bindControls) {
      volumeReset?.addEventListener("click", resetView);
      volumeCut?.addEventListener("input", () => {
        setCutDepth(Number(volumeCut.value) / 100);
      });
      volumeThreshold?.addEventListener("input", () => {
        const value = Number(volumeThreshold.value);
        viewState.threshold = value / 255;
        volumeThresholdOutput.textContent = String(value);
        renderVolume();
        notifyViewChange();
      });
    }

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(renderVolume);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", renderVolume);
    }

    return {
      setLoading(label) {
        statusElement.textContent = `Loading ${label} 3D volume…`;
      },
      setVolume(volume) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, texture);
        gl.texImage3D(
          gl.TEXTURE_3D,
          0,
          gl.R8,
          VOLUME_SIZE,
          VOLUME_SIZE,
          VOLUME_SIZE,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          volume
        );
        viewState.hasVolume = true;
        statusElement.textContent = "";
        renderVolume();
      },
      setComparisonVolume(volume) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, comparisonTexture);
        gl.texImage3D(
          gl.TEXTURE_3D,
          0,
          gl.R8,
          VOLUME_SIZE,
          VOLUME_SIZE,
          VOLUME_SIZE,
          0,
          gl.RED,
          gl.UNSIGNED_BYTE,
          volume
        );
        renderVolume();
      },
      setErrorMode(enabled) {
        viewState.errorMode = Boolean(enabled);
        renderVolume();
      },
      setViewState(nextViewState) {
        viewState.yaw = nextViewState.yaw;
        viewState.pitch = nextViewState.pitch;
        viewState.cut = nextViewState.cut;
        viewState.threshold = nextViewState.threshold;
        updateControlReadouts();
        renderVolume();
      },
      onViewChange(listener) {
        viewChangeListener = listener;
      },
      render: renderVolume
    };
  }

  const volumeRenderer = createVolumeRenderer(volumeCanvas, volumeStatus, true);
  const inputVolumeRenderer = createVolumeRenderer(inputVolumeCanvas, inputVolumeStatus);
  volumeRenderer.onViewChange((nextViewState) => inputVolumeRenderer.setViewState(nextViewState));
  inputVolumeRenderer.onViewChange((nextViewState) => volumeRenderer.setViewState(nextViewState));

  function setInputErrorMode(enabled) {
    const isEnabled = Boolean(enabled);
    inputVolumeError.setAttribute("aria-pressed", String(isEnabled));
    inputVolumeRenderer.setErrorMode(isEnabled);
  }

  inputVolumeError.addEventListener("click", () => {
    if (inputVolumeError.disabled) return;
    setInputErrorMode(inputVolumeError.getAttribute("aria-pressed") !== "true");
  });

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
    volumeTitle.textContent = `${config.label} result`;
    inputVolumeTitle.textContent = config.inputTitle;
    setInputErrorMode(false);
    inputVolumeError.disabled = levelKey === "clean";
    volumeCanvas.setAttribute("aria-label", `Rotatable cutaway rendering of the ${config.label} 3D FoJ volume`);
    inputVolumeCanvas.setAttribute("aria-label", `Rotatable cutaway rendering of the ${config.inputTitle} volume`);
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
    inputVolumeError.disabled = true;
    volumeRenderer.setLoading(noiseLevels[levelKey].label);
    inputVolumeRenderer.setLoading(noiseLevels[levelKey].label);
    demoRoot.setAttribute("aria-busy", "true");

    try {
      const volumes = await loadVolume(levelKey);
      if (requestId !== state.loadRequestId) return;
      state.noiseLevel = levelKey;
      state.volumes = volumes;
      volumeRenderer.setVolume(volumes.foj);
      inputVolumeRenderer.setVolume(volumes.input);
      inputVolumeRenderer.setComparisonVolume(volumes.foj);
      inputVolumeError.disabled = levelKey === "clean";
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
