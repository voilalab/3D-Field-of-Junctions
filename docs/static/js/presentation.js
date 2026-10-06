(() => {
  const stage = document.querySelector(".presentation-stage");
  const fit = () => {
    const width = stage.offsetWidth;
    const height = stage.offsetHeight;
    const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };
  new ResizeObserver(fit).observe(stage);
  window.addEventListener("resize", fit);
  fit();
})();
