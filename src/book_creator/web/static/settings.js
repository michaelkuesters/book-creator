(function () {
  const THEME_KEY = "bc.theme";
  const INK_KEY = "bc.ink";
  const DEFAULT_INK = {
    light: "#1a2330",
    dark: "#e6edf5",
  };

  function currentTheme() {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr;
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch (err) {
      /* ignore */
    }
    return "light";
  }

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      /* ignore */
    }
  }

  function applyInk(ink, persist) {
    const root = document.documentElement;
    if (ink) {
      root.style.setProperty("--ink", ink);
      if (persist) {
        try {
          localStorage.setItem(INK_KEY, ink);
        } catch (err) {
          /* ignore */
        }
      }
    } else {
      root.style.removeProperty("--ink");
      if (persist) {
        try {
          localStorage.removeItem(INK_KEY);
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  function storedInk() {
    try {
      return localStorage.getItem(INK_KEY);
    } catch (err) {
      return null;
    }
  }

  function setupSettingsForm() {
    const form = document.getElementById("studio-settings-form");
    if (!form) return;

    const theme = currentTheme();
    const light = document.getElementById("theme-light");
    const dark = document.getElementById("theme-dark");
    const color = document.getElementById("ink-color");
    const reset = document.getElementById("ink-reset");

    if (light) light.checked = theme === "light";
    if (dark) dark.checked = theme === "dark";

    const ink = storedInk() || DEFAULT_INK[theme] || DEFAULT_INK.light;
    if (color) color.value = ink;

    form.querySelectorAll('input[name="theme"]').forEach(function (input) {
      input.addEventListener("change", function () {
        if (!input.checked) return;
        applyTheme(input.value);
        if (!storedInk() && color) {
          color.value = DEFAULT_INK[input.value] || DEFAULT_INK.light;
          applyInk(null, false);
        }
      });
    });

    if (color) {
      color.addEventListener("input", function () {
        applyInk(color.value, true);
      });
    }

    if (reset) {
      reset.addEventListener("click", function () {
        applyInk(null, true);
        if (color) color.value = DEFAULT_INK[currentTheme()] || DEFAULT_INK.light;
      });
    }
  }

  setupSettingsForm();
})();
