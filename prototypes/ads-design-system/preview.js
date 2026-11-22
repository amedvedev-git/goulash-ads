const viewButtons = [...document.querySelectorAll("[data-view]")];
const screens = [...document.querySelectorAll(".screen")];

function showView(view, focusTitle = false) {
  for (const button of viewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  for (const screen of screens) {
    screen.hidden = screen.id !== view;
  }
  if (focusTitle) {
    document.getElementById(`${view}-title`).focus();
  }
}

for (const button of viewButtons) {
  button.addEventListener("click", () => showView(button.dataset.view));
}
for (const button of document.querySelectorAll("[data-open-view]")) {
  button.addEventListener("click", () => showView(button.dataset.openView, true));
}

const week = [2, 4, 4, 6, 2, 5, 1];
const reports = {
  7: { spend: 12480, cpa: 519, days: week, from: "12–18 ноября" },
  30: {
    spend: 48720,
    cpa: 575,
    days: [2, 2, 3, 1, 2, 3, 1, 4, 3, 0, 2, 2, 3, 2, 3, 1, 5, 2, 4, 3, 4, 4, 4, ...week],
    from: "20 октября – 18 ноября",
  },
};
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const currency = (value) => `${number.format(value)}\u00a0₽`;

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderReport(period, announce = false) {
  const { spend, cpa, days, from } = reports[period];
  const count = days.reduce((total, daily) => total + daily, 0);
  setText("report-spend", currency(spend));
  setText("report-count", number.format(count));
  setText("report-cost", currency(cpa));
  setText("report-period", `${from} · МСК`);
  setText("report-caption", `Заявки по дням за период ${from}`);

  const columns = document.getElementById("chart-columns");
  const table = document.getElementById("report-days");
  const step = Math.ceil(Math.max(...days) / 3);
  columns.toggleAttribute("data-dense", days.length > 7);
  columns.style.setProperty("--days", days.length);
  columns.replaceChildren();
  table.replaceChildren();
  document.getElementById("chart-scale").replaceChildren(...[step * 3, step * 2, step, 0].map((value) => {
    const mark = document.createElement("span");
    mark.textContent = value;
    return mark;
  }));

  for (const [index, value] of days.entries()) {
    const stamp = new Date(Date.UTC(2026, 10, 19 - days.length + index));
    const point = document.createElement("div");
    const bar = document.createElement("span");
    const label = document.createElement("span");
    point.className = "chart-column";
    bar.style.setProperty("--height", `${100 * value / (step * 3)}%`);
    if (days.length === 7 || [0, 9, 19, 29].includes(index)) {
      label.textContent = stamp.getUTCDate();
    }
    point.append(bar, label);
    columns.append(point);

    const row = table.insertRow();
    row.insertCell().textContent = date.format(stamp);
    row.insertCell().textContent = value;
  }
  if (announce) setText("report-update", `Отчёт обновлён. ${from}. Заявки: ${count}.`);
}

renderReport(document.querySelector('[name="period"]:checked').value);
for (const input of document.querySelectorAll('[name="period"]')) {
  input.addEventListener("change", () => renderReport(input.value, true));
}

const budget = document.getElementById("budget");
const error = document.getElementById("budget-error");
document.getElementById("budget-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = budget.value.trim().replaceAll(/\s/g, "");
  const valid = /^\d+$/.test(amount) && Number.isSafeInteger(Number(amount)) && Number(amount) >= 1000;
  error.hidden = valid;
  budget.setAttribute("aria-invalid", String(!valid));
  budget.setAttribute("aria-describedby", valid ? "budget-hint" : "budget-hint budget-error");
  setText("budget-result", valid ? `${currency(Number(amount))} в неделю. Сумма подходит.` : "");
  if (!valid) budget.focus();
});

document.getElementById("undo-confirm").addEventListener("click", () => {
  document.getElementById("undo-review").hidden = true;
  setText("campaign-budget", currency(13000));
  const result = document.getElementById("undo-result");
  result.hidden = false;
  result.focus();
});
