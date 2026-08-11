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
