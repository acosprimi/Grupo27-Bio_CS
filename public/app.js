const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let currentUser = null;
let activePage = "dashboard";
let toastTimer;
const pageNames = {
  dashboard: "Panel general", patients: "Pacientes", appointments: "Agenda de citas", exams: "Catálogo de exámenes",
  orders: "Órdenes", samples: "Muestras", results: "Resultados clínicos", documents: "Documentos", billing: "Facturación",
  reports: "Reportes e indicadores", users: "Usuarios y permisos", audit: "Auditoría"
};
const roleNames = { admin: "Administrador", reception: "Recepción", lab: "Laboratorista", health: "Profesional de salud" };
const icons = {
  layout: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="13" width="7" height="8" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/>',
  flask: '<path d="M9 3h6M10 3v7l-5.5 8.2A2.5 2.5 0 0 0 6.6 22h10.8a2.5 2.5 0 0 0 2.1-3.8L14 10V3"/><path d="M8 16h8"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6a1.5 1.5 0 0 0-3-1 1.5 1.5 0 0 0-3 1ZM8 11h8M8 15h8"/>',
  sample: '<path d="M7 3h10M9 3v5l-4 8a4 4 0 0 0 3.5 6h7a4 4 0 0 0 3.5-6l-4-8V3"/><path d="M7 15h10"/>',
  'file-check': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 15l2.5 2.5L16 12"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  receipt: '<path d="M4 2v20l4-2 4 2 4-2 4 2V2l-4 2-4-2-4 2z"/><path d="M8 9h8M8 13h8"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 4 3 5-7"/>',
  'user-cog': '<circle cx="10" cy="8" r="4"/><path d="M3 21v-2a7 7 0 0 1 12-4.9M19.4 15.5l1 .6-.2 1.5-1.3.5-.3 1.3-1.5.3-.8-1.1-1.4-.1-.6-1.3.8-1.1-.4-1.4 1.2-.8 1.2.7 1.3-.3z"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.7-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14" />',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'
};
const icon = (name, cls = "") => `<svg class="icon ${cls}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.file}</svg>`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const initials = value => String(value || "BT").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
const today = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const money = value => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value || 0));
const fmtDate = value => {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "2-digit" });
};
const fmtDateTime = value => value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "—";

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin", cache: "no-store", ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch {
    const offline = new Error("No se pudo conectar con el servidor. Revisa tu conexión a internet y vuelve a intentarlo.");
    offline.status = 0;
    throw offline;
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
  if (!response.ok) {
    const fallback = data
      ? "No se pudo completar la operación."
      : `El servidor respondió con un error (HTTP ${response.status}). En la demostración de Vercel la función puede haberse reiniciado; vuelve a intentarlo.`;
    const error = new Error(data?.error || fallback);
    error.status = response.status;
    error.code = data?.code;
    error.details = data?.details;
    // Sesión perdida durante el uso: se vuelve al inicio de sesión con una explicación, sin bucles de error.
    if (response.status === 401 && currentUser && !options.keepOnUnauthorized) handleSessionLost(error);
    throw error;
  }
  if (data === null) throw new Error("El servidor devolvió una respuesta que no es JSON válido. Vuelve a intentarlo.");
  return data;
}
function handleSessionLost(error) {
  if (!currentUser) return;
  showLogin(error.message || "Tu sesión terminó. Inicia sesión de nuevo.");
}
function notify(text, isError = false) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("toast-error", isError);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3800);
}
const fieldLabels = {
  documentType: "Tipo de documento", documentNumber: "Número de identificación", firstName: "Nombres", lastName: "Apellidos",
  email: "Correo electrónico", phone: "Teléfono", birthDate: "Fecha de nacimiento", sex: "Sexo", address: "Dirección",
  patientId: "Paciente", service: "Servicio", appointmentDate: "Fecha", appointmentTime: "Hora", professionalId: "Profesional",
  notes: "Observaciones", code: "Código", name: "Nombre", category: "Categoría", sampleType: "Tipo de muestra",
  turnaroundMinutes: "Tiempo estimado", price: "Precio", examIds: "Exámenes", title: "Nombre del documento",
  fullName: "Nombre completo", password: "Contraseña", role: "Rol", resultValue: "Resultado", reason: "Motivo"
};
function showError(target, error) {
  const el = typeof target === "string" ? $(target) : target;
  if (!el) return;
  const details = Array.isArray(error.details)
    ? error.details.filter(item => item && item.message).map(item => `${fieldLabels[item.field] ? `${fieldLabels[item.field]}: ` : ""}${item.message}`).join(" ")
    : "";
  el.textContent = `${error.message || "Ocurrió un error."}${details ? ` ${details}` : ""}`;
}
function roleAllowed(page) {
  const rules = {
    dashboard: ["admin", "reception", "lab", "health"], patients: ["admin", "reception", "health"],
    appointments: ["admin", "reception", "health"], exams: ["admin", "reception", "lab", "health"],
    orders: ["admin", "reception", "lab", "health"], samples: ["admin", "reception", "lab"],
    results: ["admin", "lab", "health"], documents: ["admin", "reception", "lab", "health"],
    billing: ["admin", "reception"], reports: ["admin"], users: ["admin"], audit: ["admin"]
  };
  return (rules[page] || []).includes(currentUser?.role);
}
function showShell() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-name").textContent = currentUser.fullName;
  $("#user-role").textContent = roleNames[currentUser.role] || currentUser.role;
  $("#user-avatar").textContent = initials(currentUser.fullName);
  $$(".nav-item").forEach(el => {
    el.classList.toggle("hidden", !roleAllowed(el.dataset.page));
    el.classList.remove("active");
  });
  $$("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const requested = decodeURIComponent((location.hash || "").slice(1));
  navigate(pageNames[requested] && roleAllowed(requested) ? requested : "dashboard");
  checkSystemStatus();
  refreshNotificationDot();
}
function showLogin(notice = "") {
  currentUser = null;
  closeModal();
  $("#app-shell").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  $("#login-password").value = "";
  $("#login-error").textContent = notice;
  $("#login-email").focus();
  showLocalAccess();
}
async function checkSystemStatus() {
  const status = $("#system-status");
  const banner = $("#demo-banner");
  try {
    const result = await api("/api/health", { keepOnUnauthorized: true });
    status.classList.remove("status-error");
    const label = result.ephemeral ? "Demostración · datos temporales" : result.database === "postgresql" ? "Sistema conectado" : "Servicio disponible";
    status.innerHTML = `<i></i><span>${esc(label)}</span>`;
    if (banner) {
      banner.classList.toggle("hidden", !result.ephemeral);
      if (result.ephemeral) banner.textContent = "Entorno de demostración con datos ficticios. Los registros y las sesiones son temporales y pueden reiniciarse cuando Vercel reinicie el servidor. No ingreses información real.";
    }
  } catch (error) {
    status.classList.add("status-error");
    status.innerHTML = `<i></i><span>Servicio no disponible</span>`;
    status.title = error.message;
  }
}
async function refreshNotificationDot() {
  if (!currentUser) return;
  try {
    const n = await api("/api/notifications");
    const count = n.pendingSamples + n.pendingResults + n.todayAppointments;
    $("#notification-dot").classList.toggle("hidden", count === 0);
    $("#notifications-button").setAttribute("aria-label", `Consultar pendientes: ${count}`);
  } catch { $("#notification-dot").classList.add("hidden"); }
}
async function showLocalAccess() {
  const panel = $("#local-access");
  if (!panel) return;
  try {
    const access = await api("/api/auth/local-access", { keepOnUnauthorized: true });
    if (!access.available) { panel.classList.add("hidden"); panel.innerHTML = ""; return; }
    panel.innerHTML = `<div class="local-access-heading">Acceso de demostración</div><p class="local-access-text">Entorno de pruebas con datos ficticios${access.ephemeral ? "; los registros y la sesión son temporales" : ""}. No ingreses información real de pacientes.</p><div class="local-access-credentials"><span><small>Cuenta</small><b>${esc(access.email)}</b></span></div><button type="button" class="secondary local-access-fill" id="demo-login">Entrar como administrador de demostración</button>`;
    panel.classList.remove("hidden");
    $("#demo-login").addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      $("#login-error").textContent = "";
      try {
        const data = await api("/api/auth/local-access", { method: "POST", body: "{}", keepOnUnauthorized: true });
        currentUser = data.user;
        showShell();
      } catch (error) { showError("#login-error", error); }
      finally { button.disabled = false; }
    });
  } catch {
    // Si la consulta falla, el inicio de sesión manual sigue disponible.
    panel.classList.add("hidden");
  }
}

async function start() {
  $$("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  try {
    const data = await api("/api/auth/me", { keepOnUnauthorized: true });
    if (data.user) { currentUser = data.user; showShell(); }
    else {
      const notices = {
        reset: "Tu sesión anterior ya no es válida (el servidor de demostración se reinició). Inicia sesión de nuevo.",
        inactive: "La cuenta no está activa. Inicia sesión con una cuenta autorizada.",
        expired: "Tu sesión expiró. Inicia sesión de nuevo."
      };
      showLogin(notices[data.reason] || "");
    }
  } catch (error) { showLogin(error.message); }
}
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#login-error").textContent = "";
  const submit = $("button[type=submit]", event.currentTarget);
  submit.disabled = true;
  try {
    const data = await api("/api/auth/login", { method: "POST", keepOnUnauthorized: true, body: JSON.stringify({ email: $("#login-email").value, password: $("#login-password").value }) });
    currentUser = data.user;
    showShell();
  } catch (error) { showError("#login-error", error); }
  finally { submit.disabled = false; }
});
$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}", keepOnUnauthorized: true }); }
  catch (error) { notify(error.message, true); }
  showLogin();
});
$("#navigation").addEventListener("click", event => {
  const button = event.target.closest("[data-page]");
  if (button && !button.classList.contains("hidden")) navigate(button.dataset.page);
});
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("mobile-open"));
$("#collapse-sidebar").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 760px)").matches) $("#sidebar").classList.remove("mobile-open");
  else $("#app-shell").classList.toggle("sidebar-collapsed");
});
$("#notifications-button").addEventListener("click", async () => {
  try {
    const n = await api("/api/notifications");
    const noticeRow = (page, count, symbol, title, detail) => roleAllowed(page)
      ? `<button type="button" class="notification-row" data-go="${page}"><span class="notification-symbol">${icon(symbol)}</span><span><b>${title}</b><small>${detail}</small></span><strong>${count}</strong></button>`
      : `<div class="notification-row notification-row-disabled" aria-disabled="true"><span class="notification-symbol">${icon(symbol)}</span><span><b>${title}</b><small>Disponible para el personal autorizado</small></span><strong>${count}</strong></div>`;
    openModal("Pendientes de atención", `<div class="notification-list">
      ${noticeRow("samples", n.pendingSamples, "sample", "Muestras por atender", "Recolección, recepción o procesamiento")}
      ${noticeRow("results", n.pendingResults, "file-check", "Resultados pendientes", "Registro o revisión de resultados")}
      ${noticeRow("appointments", n.todayAppointments, "calendar", "Citas programadas para hoy", "Agenda que requiere seguimiento")}
    </div><div class="form-actions"><button type="button" class="primary" id="close-notifications">Cerrar</button></div>`);
    $$(`[data-go]`, $("#modal-body")).forEach(el => el.addEventListener("click", () => { const page = el.dataset.go; closeModal(); navigate(page); }));
    $("#close-notifications").onclick = closeModal;
  } catch (error) { notify(error.message, true); }
});

async function navigate(page) {
  if (!roleAllowed(page)) { notify("Tu rol no tiene permiso para acceder a esta sección.", true); return; }
  activePage = page;
  try { history.replaceState(null, "", `#${page}`); } catch { /* ignorado */ }
  $("#sidebar").classList.remove("mobile-open");
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  $("#crumb-current").textContent = pageNames[page] || "BioTest";
  const root = $("#page-content");
  root.innerHTML = `<div class="loading-state"><span class="loading-spinner"></span><span>Cargando ${esc((pageNames[page] || "información").toLowerCase())}…</span></div>`;
  try {
    const renderers = {
      dashboard: renderDashboard, patients: renderPatients, appointments: renderAppointments, exams: renderExams,
      orders: renderOrders, samples: renderSamples, results: renderResults, documents: renderDocuments,
      billing: renderBilling, reports: renderReports, users: renderUsers, audit: renderAudit
    };
    await renderers[page](root);
    refreshNotificationDot();
  } catch (error) {
    if (error.status === 401) return; // handleSessionLost ya devolvió al inicio de sesión con una explicación
    root.innerHTML = `<section class="panel error-panel"><div class="error-symbol">!</div><h3>No se pudo cargar la información</h3><p>${esc(error.message)}</p><button class="secondary" id="retry-page">Intentar de nuevo</button></section>`;
    $("#retry-page").onclick = () => navigate(page);
  }
}
function heading(title, subtitle, action = "", label = "Nuevo registro", iconName = "plus") {
  return `<div class="page-heading"><div><div class="page-kicker">BIOTEST <span>·</span> OPERACIÓN</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action ? `<div class="heading-actions"><button class="primary" id="${action}">${icon(iconName)}<span>${esc(label)}</span></button></div>` : ""}</div>`;
}
function panel(title, body, extra = "", subtitle = "") {
  return `<section class="panel"><div class="panel-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${extra}</div>${body}</section>`;
}
function statusPill(status) {
  const cls = ({
    "Procesada": "green", "Finalizada": "green", "Publicado": "green", "Pagado": "green", "Validado": "green", "Atendida": "green", "Confirmada": "green",
    "Recibida": "blue", "Programada": "blue", "Recolectada": "blue", "Pendiente": "neutral", "Pendiente de toma": "neutral", "En revisión": "orange", "En procesamiento": "orange", "Parcial": "orange",
    "Rechazada": "red", "Cancelada": "red", "Anulado": "red", "No asistió": "red", "Inactivo": "red", "Alto": "red", "Bajo": "red"
  })[status] || "neutral";
  return `<span class="pill ${cls}"><i></i>${esc(status || "Sin estado")}</span>`;
}
function emptyRow(columns, text) { return `<tr><td colspan="${columns}" class="empty-state"><span class="empty-icon">${icon("search")}</span><b>${esc(text)}</b><small>Ajusta los filtros o registra un nuevo elemento.</small></td></tr>`; }
function tableWrap(headers, rows, emptyText = "No hay registros para mostrar") {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || emptyRow(headers.length, emptyText)}</tbody></table></div>`;
}
function tableAction(label, action, id, className = "row-action") {
  return `<button type="button" class="${className}" data-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`;
}
function statCard(label, value, note, iconName, theme = "blue") {
  return `<article class="stat-card"><div class="stat-top"><span>${esc(label)}</span><span class="stat-icon ${theme}">${icon(iconName)}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-sub"><span class="stat-indicator ${theme}"></span>${esc(note)}</div></article>`;
}
function toolbarSearch(id, placeholder, value = "") {
  return `<label class="search-box" for="${id}">${icon("search")}<input id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" autocomplete="off"></label>`;
}
function selectOptions(options, current = "") {
  return options.map(option => `<option value="${esc(Array.isArray(option) ? option[0] : option)}" ${String(Array.isArray(option) ? option[0] : option) === String(current) ? "selected" : ""}>${esc(Array.isArray(option) ? option[1] : option)}</option>`).join("");
}
function field(name, label, type = "text", required = true, extra = "", value = "") {
  return `<div class="field"><label for="${name}">${esc(label)}${required ? ' <span class="required-mark">*</span>' : ""}</label><input id="${name}" name="${name}" type="${type}" ${required ? "required" : ""} ${extra} value="${esc(value)}"></div>`;
}
function selectField(name, label, options, required = true, placeholder = "Selecciona una opción", value = "") {
  const emptyOption = `<option value="" ${value === "" || value == null ? "selected" : ""}>${esc(placeholder)}</option>`;
  return `<div class="field"><label for="${name}">${esc(label)}${required ? ' <span class="required-mark">*</span>' : ""}</label><select id="${name}" name="${name}" ${required ? "required" : ""}>${emptyOption}${selectOptions(options, value)}</select></div>`;
}
function textareaField(name, label, required = false, value = "", max = 500) {
  return `<div class="field full"><label for="${name}">${esc(label)}${required ? ' <span class="required-mark">*</span>' : ""}</label><textarea id="${name}" name="${name}" ${required ? "required" : ""} maxlength="${max}">${esc(value)}</textarea></div>`;
}
function openModal(title, body, size = "") {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = body;
  $("#modal").classList.remove("hidden");
  $("#modal .modal-card").classList.toggle("modal-wide", size === "wide");
  $("#modal-close").focus();
}
function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modal-body").innerHTML = "";
  $("#modal .modal-card").classList.remove("modal-wide");
}
$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", event => { if (event.target.id === "modal") closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });
function bindForm(formId, endpoint, method, successMessage, afterSuccess = () => {}, prepare = form => Object.fromEntries(new FormData(form).entries())) {
  const form = $(formId);
  if (!form) return;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = $("button[type=submit]", form);
    if (submit.disabled) return;
    const data = prepare(form);
    submit.disabled = true;
    const oldLabel = submit.textContent;
    submit.dataset.originalLabel = oldLabel;
    submit.innerHTML = `<span class="button-spinner"></span> Guardando…`;
    $("#record-error") && ($("#record-error").textContent = "");
    try {
      await api(endpoint, { method, body: JSON.stringify(data) });
      closeModal();
      notify(successMessage);
      await afterSuccess();
    } catch (error) {
      showError("#record-error", error);
      submit.disabled = false;
      submit.textContent = oldLabel;
    }
  });
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
}
async function renderDashboard(root) {
  const d = await api("/api/dashboard");
  const shortcuts = [];
  if (["admin", "reception"].includes(currentUser.role)) shortcuts.push(["Registrar paciente", "Crear un expediente", "users", "patient"]);
  if (["admin", "reception"].includes(currentUser.role)) shortcuts.push(["Programar una cita", "Organizar la atención", "calendar", "appointment"]);
  if (["admin", "reception", "health"].includes(currentUser.role)) shortcuts.push(["Crear una orden", "Solicitar exámenes", "clipboard", "order"]);
  if (["admin", "lab"].includes(currentUser.role)) shortcuts.push(["Revisar muestras", "Seguir el procesamiento", "sample", "samples"]);
  if (["admin", "health", "lab"].includes(currentUser.role)) shortcuts.push(["Consultar resultados", "Revisar el flujo clínico", "file-check", "results"]);
  const appointmentRows = d.recentAppointments.map(a => `<tr><td><div class="table-primary">${esc(a.patientName)}</div><small class="table-secondary">${esc(a.service)}</small></td><td>${fmtDate(a.appointmentDate)}<small class="table-secondary block">${esc(a.appointmentTime)}</small></td><td>${statusPill(a.status)}</td><td>${roleAllowed("appointments") ? tableAction("Ver agenda", "goto-appointments", a.id) : ""}</td></tr>`).join("");
  const sampleRows = d.recentSamples.map(s => `<tr><td><div class="table-primary">${esc(s.sampleCode || `M-${s.id}`)}</div><small class="table-secondary">${esc(s.patientName)}</small></td><td>${esc(s.sampleType)}</td><td>${statusPill(s.status)}</td></tr>`).join("");
  root.innerHTML = heading("Panel general", "Seguimiento de la operación diaria del laboratorio.") +
    `<div class="welcome-strip"><div><span class="welcome-label">RESUMEN OPERATIVO</span><h2>${greeting()}, ${esc(currentUser.fullName.split(" ")[0])}</h2><p>Consulta el estado de la atención, las muestras y los resultados pendientes.</p></div><div class="welcome-date"><span>${new Date().toLocaleDateString("es-CO", { weekday: "long" })}</span><b>${new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" })}</b></div></div>
    <div class="cards dashboard-cards">${statCard("Pacientes registrados", d.patients, "Expedientes en el sistema", "users")}${statCard("Citas para hoy", d.todayAppointments, "Agenda del día", "calendar", "teal")}${statCard("Muestras pendientes", d.pendingSamples, "Requieren seguimiento", "sample", "amber")}${statCard("Resultados por revisar", d.pendingResults, "Pendientes de registro o validación", "file-check", "violet")}</div>
    <div class="dashboard-grid"><div>${panel("Agenda reciente", tableWrap(["Paciente / servicio", "Fecha", "Estado", ""], appointmentRows, "No hay citas registradas"), roleAllowed("appointments") ? tableAction("Ver agenda", "goto-appointments", "") : "", "Citas recientes del laboratorio")}${panel("Muestras por atender", tableWrap(["Identificador / paciente", "Tipo de muestra", "Estado"], sampleRows, "No hay muestras registradas"), tableAction("Ver muestras", "goto-samples", ""), "Últimos movimientos registrados")}</div>
    <div>${panel("Accesos rápidos", `<div class="quick-grid">${shortcuts.map(item => `<button class="quick-action" type="button" data-quick="${item[3]}"><span class="quick-icon">${icon(item[2])}</span><span><b>${esc(item[0])}</b><small>${esc(item[1])}</small></span>${icon("arrow", "quick-arrow")}</button>`).join("")}</div>`)}
    ${panel("Sesión activa", `<div class="session-card"><div class="session-avatar">${initials(currentUser.fullName)}</div><div><b>${esc(currentUser.fullName)}</b><small>${esc(roleNames[currentUser.role])}</small><span class="session-status"><i></i> Sesión autenticada</span></div></div><div class="subtle-note">Las operaciones disponibles dependen de los permisos asignados a esta cuenta.</div>`)}
    ${panel("Flujo de atención", `<div class="workflow-steps"><div><span>01</span><b>Orden</b><small>Solicitud de exámenes</small></div><i></i><div><span>02</span><b>Muestra</b><small>Recepción y proceso</small></div><i></i><div><span>03</span><b>Resultado</b><small>Revisión y publicación</small></div></div>`)}</div></div>`;
  $$('[data-quick]', root).forEach(button => button.addEventListener("click", () => {
    const map = { patient: () => navigate("patients").then(() => openPatientModal()), appointment: () => navigate("appointments").then(() => openAppointmentModal()), order: () => navigate("orders").then(() => openOrderModal()), samples: () => navigate("samples"), results: () => navigate("results") };
    map[button.dataset.quick]?.();
  }));
  $$('[data-action^="goto-"]', root).forEach(button => button.addEventListener("click", () => navigate(button.dataset.action.replace("goto-", ""))));
}

async function renderPatients(root) {
  root.innerHTML = heading("Pacientes", "Consulta, registra y actualiza los expedientes institucionales.", ["admin", "reception"].includes(currentUser.role) ? "add-patient" : "", "Registrar paciente") + `<section class="panel"><div class="toolbar"><div>${toolbarSearch("patient-search", "Buscar por nombre, identificación o correo")}</div><span id="patient-count" class="result-count"></span></div><div id="patients-table"></div></section>`;
  if ($("#add-patient")) $("#add-patient").onclick = () => openPatientModal();
  let currentSearch = "";
  const load = async queryText => {
    currentSearch = queryText || "";
    const data = await api(`/api/patients?search=${encodeURIComponent(currentSearch)}`);
    $("#patient-count").textContent = `${data.patients.length} registros`;
    $("#patients-table").innerHTML = tableWrap(["Paciente", "Identificación", "Contacto", "Fecha de registro", "Acciones"], data.patients.map(p => `<tr><td><div class="person"><div class="person-avatar">${initials(`${p.firstName} ${p.lastName}`)}</div><div><div class="table-primary">${esc(p.firstName)} ${esc(p.lastName)}</div><small class="table-secondary">${esc(p.sex || "No especifica")}</small></div></div></td><td><div class="table-primary">${esc(p.documentNumber)}</div><small class="table-secondary">${esc(p.documentType)}</small></td><td><div>${esc(p.email)}</div><small class="table-secondary">${esc(p.phone || "Sin teléfono")}</small></td><td>${fmtDate(p.createdAt)}</td><td><div class="table-actions">${tableAction("Consultar", "patient-view", p.id)}${["admin", "reception"].includes(currentUser.role) ? tableAction("Editar", "patient-edit", p.id) : ""}</div></td></tr>`).join(""), "No se encontraron pacientes");
  };
  await load("");
  let timer;
  $("#patient-search").addEventListener("input", event => { clearTimeout(timer); timer = setTimeout(() => load(event.target.value).catch(err => notify(err.message, true)), 200); });
  $("#patients-table").addEventListener("click", async event => {
    const button = event.target.closest("[data-action]"); if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (button.dataset.action === "patient-view") await showPatientDetail(button.dataset.id);
      if (button.dataset.action === "patient-edit") await openPatientModal(button.dataset.id);
    } catch (error) {
      notify(error.status === 404 ? `${error.message} Es posible que el registro ya no exista (en la demostración de Vercel los datos son temporales). Se actualizó la lista.` : error.message, true);
      if (error.status === 404) load(currentSearch).catch(() => {});
    } finally { button.disabled = false; }
  });
}
async function openPatientModal(id = null) {
  let p = { documentType: "CC", documentNumber: "", firstName: "", lastName: "", email: "", phone: "", birthDate: "", sex: "No especifica", address: "" };
  if (id) { const data = await api(`/api/patients/${id}`); p = data.patient; }
  const body = `<form id="patient-form"><div class="form-section"><h3>Identificación</h3><p>Datos para localizar y diferenciar el expediente.</p></div><div class="form-grid">${selectField("documentType", "Tipo de documento", [["CC", "Cédula de ciudadanía"], ["TI", "Tarjeta de identidad"], ["CE", "Cédula de extranjería"], ["PA", "Pasaporte"], ["NIT", "NIT"]], true, "Selecciona el tipo", p.documentType)}${field("documentNumber", "Número de identificación", "text", true, 'maxlength="40" autocomplete="off"', p.documentNumber)}${field("firstName", "Nombres", "text", true, 'maxlength="80" autocomplete="given-name"', p.firstName)}${field("lastName", "Apellidos", "text", true, 'maxlength="100" autocomplete="family-name"', p.lastName)}</div><div class="form-section section-spaced"><h3>Contacto e información complementaria</h3><p>Los campos opcionales pueden completarse posteriormente.</p></div><div class="form-grid">${field("email", "Correo electrónico", "email", true, 'maxlength="254" autocomplete="email"', p.email)}${field("phone", "Teléfono", "tel", false, 'maxlength="40" autocomplete="tel"', p.phone)}${field("birthDate", "Fecha de nacimiento", "date", false, `max="${today()}"`, p.birthDate ? String(p.birthDate).slice(0, 10) : "")}${selectField("sex", "Sexo", [["No especifica", "No especifica"], ["Femenino", "Femenino"], ["Masculino", "Masculino"], ["Intersexual", "Intersexual"]], false, "Selecciona", p.sex || "No especifica")}${`<div class="field full"><label for="address">Dirección</label><input id="address" name="address" maxlength="240" value="${esc(p.address || "")}"></div>`}</div><div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button class="primary" type="submit">${id ? "Guardar cambios" : "Guardar paciente"}</button></div></form>`;
  openModal(id ? "Actualizar expediente" : "Registrar paciente", body, "wide");
  $("[data-close-modal]").onclick = closeModal;
  bindForm("#patient-form", id ? `/api/patients/${id}` : "/api/patients", id ? "PATCH" : "POST", id ? "Los datos del paciente se actualizaron." : "Paciente registrado correctamente.", () => navigate("patients"));
}
async function showPatientDetail(id) {
  const d = await api(`/api/patients/${id}`); const p = d.patient, h = d.history;
  const list = (items, render, cols) => tableWrap(cols, items.map(render).join(""), "No hay movimientos asociados");
  openModal("Expediente del paciente", `<div class="patient-profile"><div class="profile-avatar">${initials(`${p.firstName} ${p.lastName}`)}</div><div><h3>${esc(p.firstName)} ${esc(p.lastName)}</h3><p>${esc(p.documentType)} · ${esc(p.documentNumber)}</p><div>${esc(p.email)} <span>·</span> ${esc(p.phone || "Sin teléfono")}</div></div><div class="profile-action">${["admin", "reception"].includes(currentUser.role) ? `<button class="secondary" id="edit-profile">${icon("edit")} Editar</button>` : ""}</div></div><div class="profile-stats"><div><small>Citas registradas</small><b>${h.appointments.length}</b></div><div><small>Órdenes recientes</small><b>${h.orders.length}</b></div><div><small>Resultados publicados</small><b>${h.publishedResults}</b></div></div><div class="detail-section"><h4>Órdenes recientes</h4>${list(h.orders, o => `<tr><td>${esc(o.orderNumber)}</td><td>${fmtDate(o.createdAt)}</td><td>${statusPill(o.status)}</td></tr>`, ["Orden", "Fecha", "Estado"])}</div><div class="detail-section"><h4>Citas recientes</h4>${list(h.appointments, a => `<tr><td>${esc(a.service)}</td><td>${fmtDate(a.appointmentDate)} · ${esc(a.appointmentTime)}</td><td>${statusPill(a.status)}</td></tr>`, ["Servicio", "Fecha", "Estado"])}</div><div class="form-actions"><button class="secondary" data-close-modal>Cerrar</button></div>`, "wide");
  $("[data-close-modal]").onclick = closeModal;
  if ($("#edit-profile")) $("#edit-profile").onclick = () => openPatientModal(id).catch(error => notify(error.message, true));
}

async function renderAppointments(root) {
  root.innerHTML = heading("Agenda de citas", "Programa visitas y mantén actualizado el estado de atención.", ["admin", "reception"].includes(currentUser.role) ? "add-appointment" : "", "Programar cita") + `<section class="panel"><form id="appointment-filter" class="filter-toolbar"><div class="filter-search">${toolbarSearch("appointment-search", "Buscar paciente, documento")}</div><div class="filter-field"><label for="appointment-status-filter">Estado</label><select id="appointment-status-filter"><option value="">Todos los estados</option>${selectOptions(["Programada", "Confirmada", "Atendida", "Cancelada", "No asistió"])}</select></div><div class="filter-field"><label for="appointment-from">Desde</label><input id="appointment-from" type="date"></div><div class="filter-field"><label for="appointment-to">Hasta</label><input id="appointment-to" type="date"></div><button class="secondary" type="submit">Aplicar</button></form><div id="appointments-table"></div></section>`;
  if ($("#add-appointment")) $("#add-appointment").onclick = () => openAppointmentModal();
  const load = async () => {
    const params = new URLSearchParams({ search: $("#appointment-search").value, status: $("#appointment-status-filter").value, from: $("#appointment-from").value || "2000-01-01", to: $("#appointment-to").value || "2999-12-31" });
    const d = await api(`/api/appointments?${params}`);
    const editable = ["admin", "reception"].includes(currentUser.role);
    $("#appointments-table").innerHTML = tableWrap(["Paciente", "Servicio", "Fecha y hora", "Profesional", "Estado", "Acción"], d.appointments.map(a => `<tr><td><div class="table-primary">${esc(a.patientName)}</div><small class="table-secondary">${esc(a.documentNumber)}</small></td><td>${esc(a.service)}</td><td>${fmtDate(a.appointmentDate)}<small class="table-secondary block">${esc(a.appointmentTime)}</small></td><td>${esc(a.professionalName || "Sin asignar")}</td><td>${statusPill(a.status)}</td><td>${editable ? `<div class="table-actions">${! ["Cancelada", "No asistió"].includes(a.status) ? `<select class="compact-select" aria-label="Estado cita ${a.id}" data-appointment-status="${a.id}" data-current="${esc(a.status)}">${selectOptions(["Programada", "Confirmada", "Atendida", "Cancelada", "No asistió"], a.status)}</select>` : ""}${tableAction("Editar", "appointment-edit", a.id)}</div>` : "—"}</td></tr>`).join(""), "No hay citas para los filtros seleccionados");
  };
  $("#appointment-filter").addEventListener("submit", async event => { event.preventDefault(); try { await load(); } catch (error) { notify(error.message, true); } });
  $("#appointments-table").addEventListener("change", async event => {
    const select = event.target.closest("[data-appointment-status]"); if (!select) return;
    const previous = select.dataset.current;
    if (!window.confirm(`¿Cambiar el estado de la cita a «${select.value}»?`)) { select.value = previous; return; }
    try { await api(`/api/appointments/${select.dataset.appointmentStatus}/status`, { method: "PATCH", body: JSON.stringify({ status: select.value }) }); notify("Estado de la cita actualizado."); await load(); }
    catch (error) { notify(error.message, true); await load(); }
  });
  $("#appointments-table").addEventListener("click", async event => {
    const button = event.target.closest('[data-action="appointment-edit"]'); if (!button) return;
    try { await openAppointmentModal(button.dataset.id); } catch (error) { notify(error.message, true); }
  });
  await load();
}
async function openAppointmentModal(id = null) {
  const [p, professionals, appointments] = await Promise.all([api("/api/patients"), api("/api/professionals"), id ? api("/api/appointments") : Promise.resolve({ appointments: [] })]);
  const a = id ? appointments.appointments.find(item => String(item.id) === String(id)) : null;
  if (id && !a) throw new Error("No se encontró la cita que deseas editar.");
  const body = `<form id="appointment-form"><div class="form-grid">${selectField("patientId", "Paciente", p.patients.map(x => [x.id, `${x.firstName} ${x.lastName} · ${x.documentNumber}`]), true, "Selecciona el paciente", a?.patientId || "")}${selectField("service", "Servicio", [["Toma de muestras", "Toma de muestras"], ["Hematología", "Hematología"], ["Química clínica", "Química clínica"], ["Inmunología y serología", "Inmunología y serología"], ["Microbiología", "Microbiología"], ["Uroanálisis", "Uroanálisis"], ["Consulta de resultados", "Consulta de resultados"]], true, "Selecciona el servicio", a?.service || "")}${field("appointmentDate", "Fecha de la cita", "date", true, `min="${a?.appointmentDate && String(a.appointmentDate).slice(0, 10) < today() ? String(a.appointmentDate).slice(0, 10) : today()}"`, a?.appointmentDate ? String(a.appointmentDate).slice(0, 10) : "")}${field("appointmentTime", "Hora", "time", true, "", a?.appointmentTime || "")}${selectField("professionalId", "Profesional responsable", professionals.professionals.map(x => [x.id, x.fullName]), false, "Sin asignar", a?.professionalId || "")}${textareaField("notes", "Observaciones", false, a?.notes || "", 500)}</div>${p.patients.length ? "" : `<div class="inline-message error">Primero registra un paciente para programar la cita.</div>`}<div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary" ${p.patients.length ? "" : "disabled"}>${id ? "Guardar cambios" : "Guardar cita"}</button></div></form>`;
  openModal(id ? "Editar cita" : "Programar cita", body, "wide"); $("[data-close-modal]").onclick = closeModal;
  bindForm("#appointment-form", id ? `/api/appointments/${id}` : "/api/appointments", id ? "PATCH" : "POST", id ? "Cita actualizada correctamente." : "Cita programada correctamente.", () => navigate("appointments"));
}

async function renderExams(root) {
  const all = currentUser.role === "admin";
  root.innerHTML = heading("Catálogo de exámenes", "Consulta los servicios disponibles y sus condiciones de procesamiento.", all ? "add-exam" : "", "Agregar examen") + `<section class="panel"><div class="toolbar"><div>${toolbarSearch("exam-search", "Buscar por código, nombre o categoría")}</div><div class="toolbar-filters"><select id="exam-category-filter" aria-label="Filtrar por categoría"><option value="">Todas las categorías</option></select>${all ? `<label class="check-inline"><input id="exam-show-inactive" type="checkbox"> Incluir inactivos</label>` : ""}</div></div><div id="exams-table"></div></section>`;
  if ($("#add-exam")) $("#add-exam").onclick = () => openExamModal();
  const load = async () => {
    const params = new URLSearchParams({ search: $("#exam-search").value, category: $("#exam-category-filter").value });
    if (all && $("#exam-show-inactive").checked) params.set("all", "true");
    const d = await api(`/api/exams?${params}`);
    const category = $("#exam-category-filter").value;
    if (!category) $("#exam-category-filter").innerHTML = `<option value="">Todas las categorías</option>${selectOptions(d.categories)}`;
    else if (![...$("#exam-category-filter").options].some(option => option.value === category)) $("#exam-category-filter").value = "";
    $("#exams-table").innerHTML = tableWrap(["Código / examen", "Categoría", "Muestra requerida", "Preparación", "Procesamiento", "Tarifa", "Estado", ...(all ? ["Acción"] : [])], d.exams.map(e => `<tr><td><div class="table-primary">${esc(e.name)}</div><small class="table-secondary">${esc(e.code)}</small></td><td>${esc(e.category)}</td><td>${esc(e.sampleType)}</td><td class="wrap-cell">${esc(e.preparation || "Sin indicación configurada")}</td><td>${e.turnaroundMinutes >= 1440 ? `${Math.round(e.turnaroundMinutes / 144) / 10} días` : `${e.turnaroundMinutes} min`}</td><td>${money(e.price)}</td><td>${e.active ? statusPill("Activo") : statusPill("Inactivo")}</td>${all ? `<td>${tableAction(e.active ? "Desactivar" : "Activar", "exam-toggle", e.id)}</td>` : ""}</tr>`).join(""), "No se encontraron exámenes");
  };
  $("#exam-search").addEventListener("input", () => load().catch(e => notify(e.message, true)));
  $("#exam-category-filter").addEventListener("change", () => load().catch(e => notify(e.message, true)));
  if (all) $("#exam-show-inactive").addEventListener("change", () => load().catch(e => notify(e.message, true)));
  $("#exams-table").addEventListener("click", async event => {
    const b = event.target.closest('[data-action="exam-toggle"]'); if (!b) return;
    const active = b.textContent.trim() === "Activar";
    if (!window.confirm(`${active ? "¿Activar" : "¿Desactivar"} este examen en el catálogo?`)) return;
    try { await api(`/api/exams/${b.dataset.id}/active`, { method: "PATCH", body: JSON.stringify({ active }) }); notify("Catálogo actualizado."); await load(); }
    catch (error) { notify(error.message, true); }
  });
  await load();
}
async function openExamModal() {
  const cats = ["Hematología", "Química clínica", "Inmunología y serología", "Microbiología", "Uroanálisis", "Coprología", "Hormonas", "Pruebas especiales"];
  const samples = ["Sangre total", "Suero", "Plasma", "Orina", "Materia fecal", "Hisopado", "Otro"];
  const body = `<form id="exam-form"><div class="form-grid">${field("code", "Código interno", "text", true, 'maxlength="20" pattern="[A-Za-z0-9-]+" placeholder="HEM-003"')}${field("name", "Nombre del examen", "text", true, 'maxlength="140"')}${selectField("category", "Categoría", cats)}${selectField("sampleType", "Tipo de muestra", samples)}${field("turnaroundMinutes", "Tiempo estimado (minutos)", "number", true, 'min="1" max="100800"', "240")}${field("price", "Precio configurado (COP)", "number", true, 'min="0" max="100000000" step="100"', "0")}${field("unit", "Unidad de medida", "text", false, 'maxlength="50"')}${field("referenceRange", "Intervalo de referencia configurado", "text", false, 'maxlength="120" placeholder="Dejar vacío si depende del método"')}${textareaField("preparation", "Requisitos de preparación", false, "", 1000)}</div><div class="inline-message">Los intervalos deben configurarse según el método y las políticas del laboratorio; el catálogo no constituye una fuente de referencia clínica oficial.</div><div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary">Guardar examen</button></div></form>`;
  openModal("Agregar examen al catálogo", body, "wide"); $("[data-close-modal]").onclick = closeModal;
  bindForm("#exam-form", "/api/exams", "POST", "El examen se agregó al catálogo.", () => navigate("exams"), form => {
    const data = Object.fromEntries(new FormData(form).entries()); data.turnaroundMinutes = Number(data.turnaroundMinutes); data.price = Number(data.price); return data;
  });
}

async function renderOrders(root) {
  root.innerHTML = heading("Órdenes de laboratorio", "Agrupa exámenes por paciente y sigue el proceso hasta la publicación del resultado.", ["admin", "reception", "health"].includes(currentUser.role) ? "add-order" : "", "Crear orden") + `<section class="panel"><div class="toolbar"><div>${toolbarSearch("order-search", "Buscar orden, paciente o identificación")}</div><span id="order-count" class="result-count"></span></div><div id="orders-table"></div></section>`;
  if ($("#add-order")) $("#add-order").onclick = () => openOrderModal();
  const load = async () => {
    const d = await api(`/api/orders?search=${encodeURIComponent($("#order-search").value)}`);
    $("#order-count").textContent = `${d.orders.length} órdenes`;
    $("#orders-table").innerHTML = tableWrap(["Orden", "Paciente", "Fecha", "Exámenes", "Muestras", "Importe", "Estado", "Acciones"], d.orders.map(o => `<tr><td><div class="table-primary">${esc(o.orderNumber)}</div><small class="table-secondary">${esc(o.orderedBy || "Registro institucional")}</small></td><td><div class="table-primary">${esc(o.patientName)}</div><small class="table-secondary">${esc(o.documentNumber)}</small></td><td>${fmtDate(o.createdAt)}</td><td>${o.examCount}</td><td><span class="table-secondary">${esc(o.sampleStatuses || "Sin muestra")}</span></td><td>${money(o.total)}</td><td>${statusPill(o.status)}</td><td><div class="table-actions">${tableAction("Detalle", "order-detail", o.id)}${["admin", "reception"].includes(currentUser.role) ? (o.hasInvoice ? `<span class="table-secondary">Cobro generado</span>` : tableAction("Crear cobro", "order-invoice", o.id)) : ""}</div></td></tr>`).join(""), "No hay órdenes registradas");
  };
  $("#order-search").addEventListener("input", () => load().catch(e => notify(e.message, true)));
  $("#orders-table").addEventListener("click", async event => {
    const b = event.target.closest("[data-action]"); if (!b) return;
    if (b.dataset.action === "order-detail") await showOrderDetail(b.dataset.id);
    if (b.dataset.action === "order-invoice") await createInvoiceFromOrder(b.dataset.id);
  });
  await load();
}
async function openOrderModal() {
  const [p, ex] = await Promise.all([api("/api/patients"), api("/api/exams")]);
  const body = `<form id="order-form"><div class="form-grid">${selectField("patientId", "Paciente", p.patients.map(x => [x.id, `${x.firstName} ${x.lastName} · ${x.documentNumber}`]), true, "Selecciona el paciente")}${textareaField("reason", "Motivo u observación de la orden", false, "", 300)}</div><div class="form-section section-spaced"><h3>Exámenes solicitados</h3><p>Selecciona uno o varios exámenes activos para esta orden.</p></div><div class="exam-selection-tools"><label class="search-box">${icon("search")}<input id="order-exam-search" type="search" placeholder="Buscar examen por nombre o código"></label><span id="selected-exam-count">0 seleccionados</span></div><div id="order-exam-list" class="exam-picker">${ex.exams.map(e => `<label class="exam-option"><input type="checkbox" name="examIds" value="${e.id}" data-price="${e.price}" data-sample="${esc(e.sampleType)}"><span class="exam-option-check"></span><span class="exam-option-main"><b>${esc(e.name)}</b><small>${esc(e.code)} · ${esc(e.category)} · ${esc(e.sampleType)}</small></span><strong>${money(e.price)}</strong></label>`).join("")}</div><div class="order-total"><span>Importe estimado de los exámenes</span><strong id="order-estimated-total">${money(0)}</strong></div>${p.patients.length && ex.exams.length ? "" : `<div class="inline-message error">${!p.patients.length ? "Debes registrar un paciente antes de crear una orden. " : "No hay exámenes activos en el catálogo."}</div>`}<div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary" ${p.patients.length && ex.exams.length ? "" : "disabled"}>Crear orden</button></div></form>`;
  openModal("Nueva orden de laboratorio", body, "wide"); $("[data-close-modal]").onclick = closeModal;
  const updateSummary = () => {
    const selected = $$('input[name="examIds"]:checked', $("#order-exam-list"));
    $("#selected-exam-count").textContent = `${selected.length} seleccionados`;
    $("#order-estimated-total").textContent = money(selected.reduce((sum, item) => sum + Number(item.dataset.price || 0), 0));
  };
  $("#order-exam-list").addEventListener("change", updateSummary);
  $("#order-exam-search").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();
    $$(".exam-option", $("#order-exam-list")).forEach(label => label.classList.toggle("hidden", !label.textContent.toLowerCase().includes(q)));
  });
  bindForm("#order-form", "/api/orders", "POST", "La orden y sus muestras quedaron registradas.", () => navigate("orders"), form => {
    const data = Object.fromEntries(new FormData(form).entries());
    data.patientId = Number(data.patientId);
    data.examIds = new FormData(form).getAll("examIds").map(Number);
    return data;
  });
}
async function showOrderDetail(id) {
  const d = await api(`/api/orders/${id}`); const o = d.order;
  const canResults = ["admin", "lab", "health"].includes(currentUser.role);
  openModal(`Orden ${o.orderNumber}`, `<div class="order-detail-head"><div><span class="detail-label">PACIENTE</span><h3>${esc(o.patientName)}</h3><p>${esc(o.documentType)} · ${esc(o.documentNumber)} · ${esc(o.sex || "")}</p></div><div><span class="detail-label">FECHA DE ORDEN</span><b>${fmtDate(o.createdAt)}</b><p>${statusPill(o.status)}</p></div></div><div class="detail-section"><h4>Exámenes asociados</h4>${tableWrap(["Examen", "Muestra", "Resultado", "Estado"], d.items.map(item => `<tr><td><div class="table-primary">${esc(item.name)}</div><small class="table-secondary">${esc(item.code)} · ${esc(item.category)}</small></td><td>${esc(item.sampleCode || "—")}<small class="table-secondary block">${esc(item.sampleStatus || "Sin muestra")}</small></td><td>${currentUser.role === "reception" ? `<span class="table-secondary">Información clínica restringida</span>` : `${esc(item.resultValue || "Pendiente")}${item.unit ? ` ${esc(item.unit)}` : ""}`}</td><td>${statusPill(item.status)}</td></tr>`).join(""), "La orden no contiene exámenes")}</div><div class="detail-section"><h4>Trazabilidad de muestras</h4>${tableWrap(["Identificador", "Tipo", "Toma", "Recepción", "Estado"], d.samples.map(s => `<tr><td>${esc(s.sampleCode)}</td><td>${esc(s.sampleType)}</td><td>${fmtDateTime(s.collectedAt)}</td><td>${fmtDateTime(s.receivedAt)}</td><td>${statusPill(s.status)}</td></tr>`).join(""), "No hay muestras asociadas")}</div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cerrar</button>${canResults ? `<button type="button" class="primary" id="order-view-results">Ver resultados</button>` : ""}</div>`, "wide");
  $("[data-close-modal]").onclick = closeModal;
  if ($("#order-view-results")) $("#order-view-results").onclick = () => { closeModal(); navigate("results"); };
}

const sampleStates = ["Pendiente de toma", "Recolectada", "Recibida", "En procesamiento", "Procesada", "Rechazada", "Cancelada"];
// Debe coincidir con las transiciones válidas del servidor (PATCH /api/samples/:id/status).
const sampleTransitions = {
  "Pendiente de toma": ["Recolectada", "Cancelada"], "Recolectada": ["Recibida", "Rechazada"],
  "Recibida": ["En procesamiento", "Rechazada"], "En procesamiento": ["Procesada", "Rechazada"],
  "Procesada": [], "Finalizada": [], "Rechazada": [], "Cancelada": []
};
async function renderSamples(root) {
  const canUpdate = ["admin", "lab"].includes(currentUser.role);
  const canCreateOrder = ["admin", "reception", "health"].includes(currentUser.role);
  root.innerHTML = heading("Muestras", "Controla la identificación, recepción y avance de cada muestra.", "go-orders", canCreateOrder ? "Crear orden" : "Ver órdenes") + `<section class="panel"><form id="sample-filter" class="filter-toolbar"><div class="filter-search">${toolbarSearch("sample-search", "Buscar por identificador, paciente u orden")}</div><div class="filter-field"><label for="sample-status-filter">Estado</label><select id="sample-status-filter"><option value="">Todos los estados</option>${selectOptions(sampleStates)}</select></div><button class="secondary" type="submit">Aplicar</button></form><div id="samples-table"></div></section>`;
  $("#go-orders").onclick = async () => {
    await navigate("orders");
    if (canCreateOrder) await openOrderModal();
  };
  const load = async () => {
    const params = new URLSearchParams({ search: $("#sample-search").value, status: $("#sample-status-filter").value });
    const d = await api(`/api/samples?${params}`);
    $("#samples-table").innerHTML = tableWrap(["Identificador", "Paciente", "Orden", "Tipo de muestra", "Toma / última actualización", "Estado", ...(canUpdate ? ["Actualizar estado"] : [])], d.samples.map(s => `<tr><td><div class="table-primary">${esc(s.sampleCode || `M-${s.id}`)}</div></td><td><div class="table-primary">${esc(s.patientName)}</div><small class="table-secondary">${esc(s.documentNumber)}</small></td><td>${s.orderNumber ? tableAction(s.orderNumber, "sample-order", s.orderId) : "Registro directo"}</td><td>${esc(s.sampleType)}</td><td>${fmtDateTime(s.collectedAt || s.updatedAt)}</td><td>${statusPill(s.status)}</td>${canUpdate ? `<td>${(sampleTransitions[s.status] || []).length ? `<select class="compact-select" aria-label="Cambiar estado de muestra ${s.sampleCode || s.id}" data-sample-status="${s.id}" data-current="${esc(s.status)}"><option value="${esc(s.status)}">${esc(s.status)}</option>${sampleTransitions[s.status].map(st => `<option value="${esc(st)}">${esc(st)}</option>`).join("")}</select>` : `<span class="table-secondary">Estado final</span>`}</td>` : ""}</tr>`).join(""), "No hay muestras que coincidan con los filtros");
  };
  $("#sample-filter").addEventListener("submit", async event => { event.preventDefault(); try { await load(); } catch (e) { notify(e.message, true); } });
  $("#samples-table").addEventListener("change", async event => {
    const select = event.target.closest("[data-sample-status]"); if (!select) return;
    const previous = select.dataset.current;
    if (!window.confirm(`¿Cambiar el estado de «${previous}» a «${select.value}»?`)) { select.value = previous; return; }
    let reason = "";
    if (["Rechazada", "Cancelada"].includes(select.value)) {
      const answer = window.prompt(`Indica el motivo para ${select.value.toLowerCase()} esta muestra (mínimo 8 caracteres):`);
      if (answer === null) { select.value = previous; return; }
      reason = answer.trim();
      if (reason.length < 8) { notify("La justificación debe tener al menos 8 caracteres.", true); select.value = previous; return; }
    }
    try { await api(`/api/samples/${select.dataset.sampleStatus}/status`, { method: "PATCH", body: JSON.stringify({ status: select.value, reason }) }); notify("Estado de la muestra actualizado."); await load(); }
    catch (error) { notify(error.message, true); await load(); }
  });
  $("#samples-table").addEventListener("click", event => {
    const button = event.target.closest('[data-action="sample-order"]'); if (button) showOrderDetail(button.dataset.id).catch(error => notify(error.message, true));
  });
  await load();
}

async function renderResults(root) {
  root.innerHTML = heading("Resultados clínicos", "Registra resultados, revisa su validación y controla su publicación.") + `<section class="panel"><form id="results-filter" class="filter-toolbar"><div class="filter-search">${toolbarSearch("result-search", "Buscar por paciente, orden o examen")}</div><div class="filter-field"><label for="result-status-filter">Estado del resultado</label><select id="result-status-filter"><option value="">Todos los estados</option>${selectOptions(["Pendiente", "En revisión", "Validado", "Publicado"])}</select></div><button type="submit" class="secondary">Aplicar</button></form><div class="result-privacy-note">${icon("file-check")} <span>Los resultados se publican después de la validación por un profesional autorizado. Los valores de referencia dependen de la configuración del laboratorio.</span></div><div id="results-table"></div></section>`;
  const load = async () => {
    const params = new URLSearchParams({ search: $("#result-search").value, status: $("#result-status-filter").value });
    const d = await api(`/api/results?${params}`);
    $("#results-table").innerHTML = tableWrap(["Orden / paciente", "Examen", "Resultado", "Muestra", "Estado", "Fecha", "Acciones"], d.results.map(r => {
      const canInput = ["admin", "lab"].includes(currentUser.role) && ["En procesamiento", "Procesada", "Finalizada"].includes(r.sampleStatus) && r.status !== "Publicado";
      const canReview = ["admin", "health"].includes(currentUser.role);
      let actions = tableAction("Detalle", "result-detail", r.id);
      if (canInput) actions += tableAction(r.resultValue ? "Editar valor" : "Registrar valor", "result-input", r.id);
      if (canReview && r.status === "En revisión") actions += tableAction("Validar", "result-validate", r.id);
      if (canReview && r.status === "Validado") actions += tableAction("Publicar", "result-publish", r.id);
      if (canReview && r.status === "Publicado") actions += tableAction("Corregir", "result-correct", r.id);
      if (r.status === "Publicado") actions += tableAction("Informe", "result-report", r.id);
      return `<tr><td><div class="table-primary">${esc(r.orderNumber)}</div><small class="table-secondary">${esc(r.patientName)} · ${esc(r.documentNumber)}</small></td><td><div class="table-primary">${esc(r.examName)}</div><small class="table-secondary">${esc(r.code)}</small></td><td>${r.resultValue ? `<span>${esc(r.resultValue)} ${esc(r.unit || "")}</span>${r.resultFlag ? `<small class="flag-label">${esc(r.resultFlag)} · fuera del intervalo configurado</small>` : ""}` : `<span class="table-secondary">Sin registrar</span>`}</td><td><div>${esc(r.sampleCode || "—")}</div><small class="table-secondary">${esc(r.sampleStatus || "Sin muestra")}</small></td><td>${statusPill(r.status)}</td><td>${fmtDateTime(r.updatedAt)}</td><td><div class="table-actions wrap-actions">${actions}</div></td></tr>`;
    }).join(""), "No hay resultados para mostrar");
  };
  $("#results-filter").addEventListener("submit", async event => { event.preventDefault(); try { await load(); } catch (e) { notify(e.message, true); } });
  $("#results-table").addEventListener("click", async event => {
    const b = event.target.closest("[data-action]"); if (!b) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.action === "result-detail") await showResultDetail(id);
      if (b.dataset.action === "result-input") await openResultInput(id);
      if (b.dataset.action === "result-validate") {
        if (window.confirm("¿Confirmas que revisaste este resultado y deseas validarlo?")) { await api(`/api/results/${id}/review`, { method: "PATCH", body: JSON.stringify({ status: "Validado" }) }); notify("Resultado validado."); await load(); }
      }
      if (b.dataset.action === "result-publish") {
        if (window.confirm("¿Publicar el resultado validado? Después de la publicación, las modificaciones requieren una corrección trazable.")) { await api(`/api/results/${id}/review`, { method: "PATCH", body: JSON.stringify({ status: "Publicado" }) }); notify("Resultado publicado."); await load(); }
      }
      if (b.dataset.action === "result-correct") await openResultCorrection(id);
      if (b.dataset.action === "result-report") await showResultReport(id);
    } catch (error) { notify(error.message, true); }
  });
  await load();
}
async function openResultInput(id) {
  const d = await api(`/api/results?search=`); const item = d.results.find(x => String(x.id) === String(id));
  if (!item) throw new Error("No se encontró el resultado.");
  const body = `<div class="result-context"><span class="detail-label">${esc(item.orderNumber)}</span><h3>${esc(item.examName)}</h3><p>${esc(item.patientName)} · ${esc(item.documentNumber)}</p><div class="result-context-meta"><span>Unidad: <b>${esc(item.unit || "No configurada")}</b></span><span>Intervalo configurado: <b>${esc(item.referenceRange || "No configurado")}</b></span></div></div><form id="result-input-form"><div class="form-grid">${field("resultValue", "Valor obtenido", "text", true, 'maxlength="180" placeholder="Ingresa el valor o el texto del resultado"', item.resultValue || "")}</div><div class="inline-message">Verifica el registro original antes de guardar. Si el resultado se publica, ya no podrá editarse directamente.</div><div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary">Guardar y enviar a revisión</button></div></form>`;
  openModal("Registrar resultado", body); $("[data-close-modal]").onclick = closeModal;
  bindForm("#result-input-form", `/api/results/${id}`, "POST", "Resultado guardado y enviado a revisión.", () => navigate("results"));
}
async function showResultDetail(id) {
  const d = await api("/api/results"); const r = d.results.find(x => String(x.id) === String(id));
  if (!r) throw new Error("No se encontró el resultado.");
  const history = ["admin", "health"].includes(currentUser.role) ? await api(`/api/results/${id}/history`) : { corrections: [] };
  const historyHtml = history.corrections.length ? `<div class="detail-section"><h4>Historial de correcciones</h4>${tableWrap(["Fecha", "Responsable", "Valor anterior", "Valor corregido", "Motivo"], history.corrections.map(c => `<tr><td>${fmtDateTime(c.createdAt)}</td><td>${esc(c.actorName || "Usuario")}</td><td>${esc(c.previousValue)}</td><td>${esc(c.correctedValue)}</td><td class="wrap-cell">${esc(c.reason)}</td></tr>`).join(""), "Sin correcciones")}</div>` : "";
  openModal("Detalle del resultado", `<div class="result-report-header"><div class="report-mark">BT</div><div><b>BioTest Diagnósticos S.A.S.</b><small>Información de laboratorio</small></div><div class="report-status">${statusPill(r.status)}</div></div><div class="report-patient"><span>Paciente</span><h3>${esc(r.patientName)}</h3><p>${esc(r.documentType)} · ${esc(r.documentNumber)}</p><div>Orden: <b>${esc(r.orderNumber)}</b> <span>·</span> Fecha de actualización: <b>${fmtDateTime(r.updatedAt)}</b></div></div><div class="report-result-block"><div><span>Examen</span><b>${esc(r.examName)}</b></div><div><span>Resultado</span><b>${esc(r.resultValue || "Pendiente de registro")} ${esc(r.unit || "")}</b></div><div><span>Intervalo configurado</span><b>${esc(r.referenceRange || "No configurado")}</b></div><div><span>Muestra</span><b>${esc(r.sampleCode || "—")} · ${esc(r.sampleStatus || "—")}</b></div></div><p class="report-disclaimer">La interpretación corresponde al profesional de salud responsable. El sistema presenta la información registrada y no realiza diagnósticos automáticos.</p>${historyHtml}<div class="form-actions"><button class="secondary" data-close-modal>Cerrar</button>${r.status === "Publicado" ? `<button class="primary" id="print-result-detail">${icon("print")} Abrir informe para impresión</button>` : ""}</div>`, "wide");
  $("[data-close-modal]").onclick = closeModal;
  if ($("#print-result-detail")) $("#print-result-detail").onclick = () => showResultReport(id);
}
async function openResultCorrection(id) {
  const d = await api("/api/results"); const r = d.results.find(x => String(x.id) === String(id));
  if (!r) throw new Error("No se encontró el resultado.");
  const body = `<div class="inline-message error">El resultado publicado se sustituirá por una versión en revisión. La modificación requiere justificación y una nueva validación antes de publicarse.</div><form id="result-correction-form"><div class="form-grid">${field("resultValue", "Valor corregido", "text", true, 'maxlength="180"', r.resultValue)}${textareaField("reason", "Motivo de la corrección", true, "", 500)}</div><div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary">Registrar corrección</button></div></form>`;
  openModal("Corrección de resultado publicado", body); $("[data-close-modal]").onclick = closeModal;
  bindForm("#result-correction-form", `/api/results/${id}/correction`, "PATCH", "La corrección se envió a revisión.", () => navigate("results"));
}
async function showResultReport(id) {
  const d = await api("/api/results?published=true"); const r = d.results.find(x => String(x.id) === String(id));
  if (!r) throw new Error("El resultado no está publicado o no existe.");
  const order = await api(`/api/orders/${r.orderId}`);
  const publishedItems = order.items.filter(item => item.status === "Publicado");
  openModal("Informe de resultados", `<article class="clinical-report"><header class="clinical-report-brand"><div class="report-mark">BT</div><div><h2>BioTest Diagnósticos S.A.S.</h2><p>Informe de resultados de laboratorio</p></div><div class="report-state">${statusPill("Publicado")}</div></header><div class="clinical-report-meta"><div><span>Paciente</span><b>${esc(order.order.patientName)}</b><small>${esc(order.order.documentType)} · ${esc(order.order.documentNumber)}</small></div><div><span>Orden</span><b>${esc(order.order.orderNumber)}</b><small>Emitido: ${fmtDate(new Date().toISOString())}</small></div></div><div class="table-wrap"><table><thead><tr><th>Examen</th><th>Resultado</th><th>Unidad</th><th>Intervalo configurado</th><th>Estado</th></tr></thead><tbody>${publishedItems.map(item => `<tr><td>${esc(item.name)}</td><td><b>${esc(item.resultValue)}</b>${item.resultFlag ? `<small class="flag-label">${esc(item.resultFlag)}</small>` : ""}</td><td>${esc(item.unit || "—")}</td><td>${esc(item.referenceRange || "No configurado")}</td><td>${statusPill(item.status)}</td></tr>`).join("")}</tbody></table></div><div class="clinical-report-note">Los intervalos de referencia pueden variar según el método, el laboratorio y las características del paciente. Este informe contiene los datos registrados y validados por los responsables; su interpretación clínica corresponde al profesional de salud.</div><footer class="clinical-report-footer"><span>Documento asociado a la orden ${esc(order.order.orderNumber)}</span><span>${fmtDate(new Date().toISOString())}</span></footer></article><div class="form-actions"><button class="secondary" data-close-modal>Cerrar</button><button class="primary" id="print-clinical-report">${icon("print")} Imprimir / Guardar como PDF</button></div>`, "wide");
  $("[data-close-modal]").onclick = closeModal;
  $("#print-clinical-report").onclick = () => printModalContent();
}
function printModalContent() {
  document.body.classList.add("printing-modal");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-modal"), 500);
}

async function renderDocuments(root) {
  root.innerHTML = heading("Documentos", "Registra y consulta metadatos de documentos asociados a la atención.", "add-document", "Registrar documento") + `<section class="panel"><div class="toolbar"><div>${toolbarSearch("document-search", "Buscar por nombre, tipo, paciente u orden")}</div><span id="document-count" class="result-count"></span></div><div class="inline-message">Este apartado registra metadatos y relaciones. La carga y el almacenamiento de archivos todavía requieren configurar un repositorio de documentos protegido.</div><div id="documents-table"></div></section>`;
  $("#add-document").onclick = () => openDocumentModal();
  const load = async () => {
    const d = await api(`/api/documents?search=${encodeURIComponent($("#document-search").value)}`);
    $("#document-count").textContent = `${d.documents.length} documentos`;
    $("#documents-table").innerHTML = tableWrap(["Documento", "Tipo", "Paciente / orden", "Responsable", "Fecha de registro"], d.documents.map(doc => `<tr><td><div class="table-primary">${icon("file")} ${esc(doc.title)}</div><small class="table-secondary">${esc(doc.description || "Sin descripción adicional")}</small></td><td>${esc(doc.documentType)}</td><td>${esc(doc.patientName || "Sin paciente asociado")}<small class="table-secondary block">${esc(doc.orderNumber || "Sin orden asociada")}</small></td><td>${esc(doc.responsibleName || "Sistema")}</td><td>${fmtDateTime(doc.createdAt)}</td></tr>`).join(""), "No hay documentos registrados");
  };
  $("#document-search").addEventListener("input", () => load().catch(e => notify(e.message, true)));
  await load();
}
async function openDocumentModal() {
  const canListPatients = ["admin", "reception", "health"].includes(currentUser.role);
  const [p, o] = await Promise.all([canListPatients ? api("/api/patients") : Promise.resolve({ patients: [] }), api("/api/orders")]);
  const body = `<form id="document-form"><div class="form-grid">${field("title", "Nombre del documento", "text", true, 'maxlength="180"')}${selectField("documentType", "Tipo de documento", [["Orden médica", "Orden médica"], ["Consentimiento", "Consentimiento"], ["Soporte administrativo", "Soporte administrativo"], ["Informe de laboratorio", "Informe de laboratorio"], ["Identificación", "Identificación"], ["Otro", "Otro"]])}${canListPatients ? selectField("patientId", "Paciente asociado", p.patients.map(x => [x.id, `${x.firstName} ${x.lastName} · ${x.documentNumber}`]), false, "Sin asociación directa") : ""}${selectField("orderId", "Orden asociada", o.orders.map(x => [x.id, `${x.orderNumber} · ${x.patientName}`]), false, "Sin asociación a orden")}${textareaField("description", "Descripción / notas", false, "", 500)}</div><div class="inline-message">No ingreses datos clínicos sensibles en la descripción. Registra solo la información necesaria para identificar el documento.</div><div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary">Guardar registro</button></div></form>`;
  openModal("Registrar documento", body, "wide"); $("[data-close-modal]").onclick = closeModal;
  bindForm("#document-form", "/api/documents", "POST", "Se registraron los metadatos del documento.", () => navigate("documents"));
  if (!canListPatients) $("#record-error").insertAdjacentHTML("beforebegin", `<div class="inline-message">Con tu rol solo puedes asociar el documento a una orden.</div>`);
}

async function renderBilling(root) {
  root.innerHTML = heading("Facturación", "Consulta los importes configurados y actualiza el estado administrativo de los cobros.", "add-invoice", "Crear cobro") + `<section class="panel"><div class="filter-toolbar"><div class="filter-search">${toolbarSearch("invoice-search", "Buscar por cobro, orden o paciente")}</div><div class="filter-field"><label for="invoice-status-filter">Estado</label><select id="invoice-status-filter"><option value="">Todos los estados</option>${selectOptions(["Pendiente", "Pagado", "Parcial", "Anulado"])}</select></div></div><div id="billing-summary" class="billing-summary"></div><div id="invoices-table"></div><div class="integration-note"><span class="integration-indicator"></span><span><b>Gestión local de cobros</b><small>No hay pasarela de pago ni conexión con facturación electrónica configurada.</small></span></div></section>`;
  $("#add-invoice").onclick = () => openInvoiceModal();
  const load = async () => {
    const params = new URLSearchParams({ search: $("#invoice-search").value, status: $("#invoice-status-filter").value });
    const d = await api(`/api/invoices?${params}`);
    const total = d.invoices.filter(i => i.status !== "Anulado").reduce((sum, i) => sum + Number(i.subtotal), 0);
    const outstanding = d.invoices.filter(i => ["Pendiente", "Parcial"].includes(i.status)).reduce((sum, i) => sum + Math.max(0, Number(i.subtotal) - Number(i.amountPaid || 0)), 0);
    $("#billing-summary").innerHTML = `<div><span>Cobros registrados</span><b>${d.invoices.length}</b></div><div><span>Importe no anulado</span><b>${money(total)}</b></div><div><span>Pendiente de pago</span><b>${money(outstanding)}</b></div>`;
    $("#invoices-table").innerHTML = tableWrap(["Referencia", "Paciente / orden", "Fecha", "Importe total", "Recibido / saldo", "Estado", "Actualizar"], d.invoices.map(i => `<tr><td><div class="table-primary">${esc(i.invoiceNumber)}</div></td><td><div class="table-primary">${esc(i.patientName)}</div><small class="table-secondary">${esc(i.orderNumber)}</small></td><td>${fmtDate(i.createdAt)}</td><td><b>${money(i.subtotal)}</b></td><td><div>${money(i.amountPaid || 0)} recibido</div><small class="table-secondary">${money(Math.max(0, Number(i.subtotal) - Number(i.amountPaid || 0)))} pendiente</small></td><td>${statusPill(i.status)}</td><td>${i.status === "Anulado" ? "—" : `<select class="compact-select" aria-label="Estado cobro ${i.invoiceNumber}" data-invoice-status="${i.id}" data-current="${esc(i.status)}" data-subtotal="${i.subtotal}">${selectOptions(["Pendiente", "Parcial", "Pagado", "Anulado"], i.status)}</select>`}</td></tr>`).join(""), "No hay documentos de cobro para los filtros seleccionados");
  };
  $("#invoice-search").addEventListener("input", () => load().catch(e => notify(e.message, true)));
  $("#invoice-status-filter").addEventListener("change", () => load().catch(e => notify(e.message, true)));
  $("#invoices-table").addEventListener("change", async event => {
    const s = event.target.closest("[data-invoice-status]"); if (!s) return;
    if (!window.confirm(`¿Actualizar el estado del cobro a «${s.value}»?`)) { s.value = s.dataset.current; return; }
    let amountPaid;
    if (s.value === "Parcial") {
      const entered = window.prompt(`Importe recibido hasta el momento (total del cobro: ${money(s.dataset.subtotal)}):`);
      if (entered === null) { s.value = s.dataset.current; return; }
      amountPaid = Number(entered.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));
      if (!Number.isFinite(amountPaid) || amountPaid <= 0 || amountPaid >= Number(s.dataset.subtotal)) { notify("El pago parcial debe ser mayor que cero y menor que el total.", true); s.value = s.dataset.current; return; }
    }
    try { await api(`/api/invoices/${s.dataset.invoiceStatus}/status`, { method: "PATCH", body: JSON.stringify({ status: s.value, ...(amountPaid === undefined ? {} : { amountPaid }) }) }); notify("Estado administrativo actualizado."); await load(); }
    catch (error) { notify(error.message, true); await load(); }
  });
  await load();
}
async function createInvoiceFromOrder(orderId) {
  if (!window.confirm("¿Crear el documento de cobro para esta orden con los precios configurados en el catálogo?")) return;
  try { await api("/api/invoices", { method: "POST", body: JSON.stringify({ orderId: Number(orderId) }) }); notify("Documento de cobro creado."); if (activePage === "orders") await navigate("orders"); else await navigate("billing"); }
  catch (error) { notify(error.message, true); }
}
async function openInvoiceModal() {
  const [ordersData, invoicesData] = await Promise.all([api("/api/orders"), api("/api/invoices")]);
  const existing = new Set(invoicesData.invoices.map(invoice => Number(invoice.orderId)));
  const orders = ordersData.orders.filter(order => !existing.has(Number(order.id)));
  const options = orders.map(o => [o.id, `${o.orderNumber} · ${o.patientName} · ${money(o.total)}`]);
  const body = `<form id="invoice-form">${selectField("orderId", "Orden de laboratorio", options, true, "Selecciona una orden")}${options.length ? `<p class="hint">El importe se calcula con los precios vigentes del catálogo de exámenes.</p>` : `<div class="inline-message">No hay órdenes pendientes de generar cobro.</div>`}<div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary" ${options.length ? "" : "disabled"}>Crear documento de cobro</button></div></form>`;
  openModal("Crear documento de cobro", body); $("[data-close-modal]").onclick = closeModal;
  bindForm("#invoice-form", "/api/invoices", "POST", "Documento de cobro generado.", () => navigate("billing"), form => ({ orderId: Number(new FormData(form).get("orderId")) }));
}

async function renderReports(root) {
  const currentDate = today(), first = `${currentDate.slice(0, 7)}-01`;
  root.innerHTML = heading("Reportes e indicadores", "Analiza la actividad registrada durante un periodo específico.") + `<section class="panel"><form id="report-filter" class="filter-toolbar"><div class="filter-field"><label for="report-from">Desde</label><input id="report-from" type="date" value="${first}" required></div><div class="filter-field"><label for="report-to">Hasta</label><input id="report-to" type="date" value="${currentDate}" required></div><button class="primary" type="submit">Aplicar filtros</button><button class="secondary" type="button" id="export-report">Exportar CSV</button><button class="secondary" type="button" id="print-report">${icon("print")} Imprimir</button></form><p id="report-period" class="report-period"></p><div id="report-content"></div></section>`;
  let reportData = null;
  const load = async () => {
    const from = $("#report-from").value, to = $("#report-to").value;
    if (from > to) throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
    const d = await api(`/api/reports/summary?from=${from}&to=${to}`); reportData = d;
    $("#report-period").textContent = `Periodo consultado: ${fmtDate(from)} — ${fmtDate(to)}`;
    $("#report-content").innerHTML = `<div class="report-numbers">${[["Pacientes registrados", d.patients], ["Citas", d.appointments], ["Órdenes", d.orders], ["Muestras", d.samples], ["Cobros no anulados", money(d.invoices.total)], ["Tiempo medio de proceso", d.averageProcessingMinutes == null ? "Sin datos" : `${d.averageProcessingMinutes} min`]].map(x => `<div class="report-number"><small>${esc(x[0])}</small><strong>${esc(x[1])}</strong></div>`).join("")}</div><div class="reports-grid">${panel("Muestras por estado", tableWrap(["Estado", "Cantidad"], d.sampleStatuses.map(s => `<tr><td>${statusPill(s.status)}</td><td>${s.count}</td></tr>`).join(""), "Sin registros en el periodo"))}${panel("Resultados por estado", tableWrap(["Estado", "Cantidad"], d.resultStatuses.map(s => `<tr><td>${statusPill(s.status)}</td><td>${s.count}</td></tr>`).join(""), "Sin resultados en el periodo"))}</div>${panel("Exámenes más solicitados", tableWrap(["Examen", "Solicitudes"], d.topExams.map(e => `<tr><td>${esc(e.name)}</td><td>${e.count}</td></tr>`).join(""), "Sin solicitudes en el periodo"))}`;
  };
  $("#report-filter").addEventListener("submit", async event => { event.preventDefault(); try { await load(); } catch (error) { notify(error.message, true); } });
  $("#export-report").onclick = () => {
    if (!reportData) return notify("Aplica un periodo antes de exportar.", true);
    const d = reportData;
    downloadCsv("reporte-biotest.csv", [["Periodo", `${d.from} a ${d.to}`], ["Indicador", "Cantidad"], ["Pacientes registrados", d.patients], ["Citas", d.appointments], ["Órdenes", d.orders], ["Muestras", d.samples], ["Importe de cobros", d.invoices.total], ["Tiempo medio (minutos)", d.averageProcessingMinutes ?? "Sin datos"], ...d.sampleStatuses.map(s => [`Muestras · ${s.status}`, s.count]), ...d.resultStatuses.map(s => [`Resultados · ${s.status}`, s.count]), ...d.topExams.map(e => [`Examen · ${e.name}`, e.count])]);
  };
  $("#print-report").onclick = () => { if (!reportData) return notify("Aplica un periodo antes de imprimir.", true); document.body.classList.add("printing-page"); window.print(); setTimeout(() => document.body.classList.remove("printing-page"), 500); };
  try { await load(); } catch (error) { notify(error.message, true); }
}
function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => {
    let safe = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(safe)) safe = `'${safe}`;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

async function renderUsers(root) {
  const d = await api("/api/users");
  root.innerHTML = heading("Usuarios y permisos", "Administra las cuentas de acceso y las responsabilidades de cada rol.", "add-user", "Crear usuario") + `<div class="role-grid"><div><b>Administrador</b><p>Configuración, usuarios, reportes y supervisión.</p></div><div><b>Recepción</b><p>Pacientes, citas, órdenes y gestión administrativa.</p></div><div><b>Laboratorista</b><p>Muestras y registro de resultados.</p></div><div><b>Profesional de salud</b><p>Revisión, validación y publicación de resultados.</p></div></div><section class="panel"><div class="toolbar"><div class="section-title"><h3>Directorio de usuarios</h3><p>Los cambios de rol quedan registrados en auditoría.</p></div><span class="result-count">${d.users.length} cuentas</span></div><div id="users-table">${tableWrap(["Usuario", "Correo", "Rol asignado", "Estado", "Creación", "Acciones"], d.users.map(u => `<tr><td><div class="person"><div class="person-avatar">${initials(u.fullName)}</div><div class="table-primary">${esc(u.fullName)}</div></div></td><td>${esc(u.email)}</td><td><select class="compact-select" aria-label="Rol de ${esc(u.fullName)}" data-user-role="${u.id}" data-current="${u.role}" ${Number(u.id) === Number(currentUser.id) ? "disabled" : ""}>${selectOptions([["admin", "Administrador"], ["reception", "Recepción"], ["lab", "Laboratorista"], ["health", "Profesional de salud"]], u.role)}</select></td><td>${statusPill(u.active ? "Activo" : "Inactivo")}</td><td>${fmtDate(u.createdAt)}</td><td>${Number(u.id) === Number(currentUser.id) ? `<span class="table-secondary">Cuenta actual</span>` : tableAction(u.active ? "Desactivar" : "Activar", "user-toggle", u.id)}</td></tr>`).join(""), "No hay usuarios registrados")}</div></section>`;
  $("#add-user").onclick = () => openUserModal();
  $("#users-table").addEventListener("change", async event => {
    const select = event.target.closest("[data-user-role]"); if (!select) return;
    const previous = select.dataset.current;
    if (!window.confirm(`¿Cambiar el rol de esta cuenta a «${roleNames[select.value]}»?`)) { select.value = previous; return; }
    try { await api(`/api/users/${select.dataset.userRole}`, { method: "PATCH", body: JSON.stringify({ role: select.value }) }); notify("Permisos actualizados."); await navigate("users"); }
    catch (error) { notify(error.message, true); select.value = previous; }
  });
  $("#users-table").addEventListener("click", async event => {
    const b = event.target.closest('[data-action="user-toggle"]'); if (!b) return;
    const row = b.closest("tr"), active = b.textContent.trim() === "Activar";
    const targetName = row.querySelector(".table-primary")?.textContent || "la cuenta";
    if (!window.confirm(`¿${active ? "Activar" : "desactivar"} el acceso de ${targetName}?`)) return;
    try { await api(`/api/users/${b.dataset.id}`, { method: "PATCH", body: JSON.stringify({ active }) }); notify("Estado de la cuenta actualizado."); await navigate("users"); }
    catch (error) { notify(error.message, true); }
  });
}
async function openUserModal() {
  const body = `<form id="user-form"><div class="form-grid">${field("fullName", "Nombre completo", "text", true, 'minlength="3" maxlength="140" autocomplete="name"')}${field("email", "Correo institucional", "email", true, 'maxlength="254" autocomplete="email"')}${field("password", "Contraseña inicial", "password", true, 'minlength="12" maxlength="128" autocomplete="new-password"')}${selectField("role", "Rol", [["reception", "Recepción"], ["lab", "Laboratorista"], ["health", "Profesional de salud"], ["admin", "Administrador"]])}</div><div class="inline-message">La contraseña inicial debe tener al menos 12 caracteres. El servidor guarda únicamente una versión cifrada mediante hash.</div><div class="form-error" id="record-error" role="alert"></div><div class="form-actions"><button type="button" class="secondary" data-close-modal>Cancelar</button><button type="submit" class="primary">Crear cuenta</button></div></form>`;
  openModal("Crear usuario institucional", body); $("[data-close-modal]").onclick = closeModal;
  bindForm("#user-form", "/api/users", "POST", "Cuenta creada correctamente.", () => navigate("users"));
}
async function renderAudit(root) {
  const d = await api("/api/audit");
  root.innerHTML = heading("Auditoría", "Consulta el historial de operaciones administrativas y clínicas relevantes.") + `<section class="panel"><div class="toolbar"><div>${toolbarSearch("audit-search", "Buscar usuario, acción o entidad")}</div><span class="result-count">${d.entries.length} eventos recientes</span></div><div id="audit-table">${tableWrap(["Fecha y hora", "Usuario", "Acción", "Entidad", "Referencia"], d.entries.map(e => `<tr><td>${fmtDateTime(e.createdAt)}</td><td>${esc(e.actorName || "Sistema")}</td><td><span class="audit-action">${esc(e.action)}</span></td><td>${esc(e.entityType)}</td><td>${esc(e.entityId ?? "—")}</td></tr>`).join(""), "No hay eventos registrados")}</div></section>`;
  $("#audit-search").addEventListener("input", event => {
    const q = event.target.value.toLowerCase();
    const filtered = d.entries.filter(e => [e.actorName, e.action, e.entityType, e.entityId].some(v => String(v ?? "").toLowerCase().includes(q)));
    $("#audit-table").innerHTML = tableWrap(["Fecha y hora", "Usuario", "Acción", "Entidad", "Referencia"], filtered.map(e => `<tr><td>${fmtDateTime(e.createdAt)}</td><td>${esc(e.actorName || "Sistema")}</td><td><span class="audit-action">${esc(e.action)}</span></td><td>${esc(e.entityType)}</td><td>${esc(e.entityId ?? "—")}</td></tr>`).join(""), "No hay eventos para la búsqueda");
  });
}

start();

window.addEventListener("unhandledrejection", event => {
  const error = event.reason;
  if (error && error.status === 401) return;
  console.error("Error no controlado:", error);
  if (currentUser) notify(error?.message || "Ocurrió un error inesperado. Vuelve a intentarlo.", true);
});
