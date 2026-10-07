(function () {
  document.querySelectorAll("[data-open-dialog]").forEach(function (button) {
    button.addEventListener("click", function () {
      const dialog = document.getElementById(button.getAttribute("data-open-dialog"));
      if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    });
  });

  document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
    button.addEventListener("click", function () {
      const dialog = button.closest("dialog");
      if (dialog) dialog.close();
    });
  });
})();
