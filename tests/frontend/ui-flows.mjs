// Pruebas de interfaz en un navegador real (Chromium) contra el servidor simulado.
// Uso: node tests/frontend/mock-server.mjs &  luego  node tests/frontend/ui-flows.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = `http://127.0.0.1:${process.env.MOCK_PORT || 3100}`;
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name, e.message]); console.log("FAIL", name, "\n   ", e.message.split("\n")[0]); }
};
const hit = path => fetch(`${base}/__test/${path}`).then(r => r.json());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const consoleErrors = [], failedRequests = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));
page.on("response", r => { if (r.url().includes("/api/") && r.status() >= 400) failedRequests.push(`${r.status()} ${new URL(r.url()).pathname}`); });
page.on("dialog", d => d.accept());

await hit("reset");
await page.goto(base);

await check("1. La pantalla de acceso carga y /api/auth/local-access responde 200 (sin 404 en consola)", async () => {
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
  await page.locator("#demo-login").waitFor();
  assert.equal(failedRequests.filter(x => x.includes("local-access")).length, 0, failedRequests.join(","));
  assert.equal(consoleErrors.length, 0, consoleErrors.join(" | "));
});
await check("2. Credenciales inválidas muestran mensaje claro", async () => {
  await page.getByLabel("Correo electrónico").fill("admin@biotest.local");
  await page.getByLabel("Contraseña").fill("mala");
  await page.getByRole("button", { name: /Ingresar al sistema/ }).click();
  await page.locator("#login-error").filter({ hasText: "Credenciales incorrectas" }).waitFor();
  failedRequests.length = 0; consoleErrors.length = 0;
});
await check("3. El acceso de demostración entra al panel y muestra el aviso de datos temporales", async () => {
  await page.locator("#demo-login").click();
  await page.getByRole("heading", { name: "Panel general" }).waitFor();
  await page.locator("#demo-banner").filter({ hasText: "datos ficticios" }).waitFor();
  assert.match(await page.locator("#page-content").innerText(), /Pacientes registrados/);
});
await check("4. Pacientes: la lista carga", async () => {
  await page.getByRole("button", { name: /^Pacientes/ }).click();
  await page.getByRole("heading", { name: "Pacientes", exact: true }).waitFor();
  await page.locator("#patients-table tbody tr").nth(1).waitFor();
  assert.equal(await page.locator("#patients-table tbody tr").count(), 2);
});
await check("5. «Consultar» abre el expediente del paciente CORRECTO (2.º registro)", async () => {
  await page.locator("#patients-table tbody tr").nth(1).getByRole("button", { name: "Consultar" }).click();
  await page.locator("#modal-title").filter({ hasText: "Expediente del paciente" }).waitFor();
  const text = await page.locator("#modal-body").innerText();
  assert.match(text, /Carlos Demostración Dos/); assert.match(text, /1000000002/); assert.doesNotMatch(text, /Ana María/);
  await page.locator("#modal-body [data-close-modal]").click();
});
await check("6. «Editar» abre el formulario con los datos actuales", async () => {
  await page.locator("#patients-table tbody tr").nth(0).getByRole("button", { name: "Editar" }).click();
  await page.locator("#patient-form").waitFor();
  assert.equal(await page.locator("#firstName").inputValue(), "Ana María");
  assert.equal(await page.locator("#documentNumber").inputValue(), "1000000001");
  assert.equal(await page.locator("#birthDate").inputValue(), "1990-05-12");
  assert.equal(await page.locator("#sex").inputValue(), "Femenino");
});
await check("7. Editar valida en servidor y muestra el campo y el motivo", async () => {
  await page.locator("#firstName").fill("A");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.locator("#record-error").filter({ hasText: "Nombres: Debe tener al menos 2 caracteres." }).waitFor();
});
await check("8. Editar guarda, cierra, avisa y la lista refleja el cambio", async () => {
  await page.locator("#firstName").fill("Ana Lucía");
  await page.locator("#phone").fill("3111111111");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.locator("#toast").filter({ hasText: "Los datos del paciente se actualizaron." }).waitFor();
  await page.locator("#modal").waitFor({ state: "hidden" });
  await page.locator("#patients-table").getByText("Ana Lucía").waitFor();
  await page.locator("#patients-table").getByText("3111111111").waitFor();
});
await check("9. La vista Consultar muestra los datos guardados y su botón Editar funciona", async () => {
  await page.locator("#patients-table tbody tr").nth(0).getByRole("button", { name: "Consultar" }).click();
  await page.locator("#modal-body").getByText("Ana Lucía").first().waitFor();
  assert.match(await page.locator("#modal-body").innerText(), /3111111111/);
  await page.locator("#edit-profile").click();
  await page.locator("#patient-form").waitFor();
  assert.equal(await page.locator("#phone").inputValue(), "3111111111");
  await page.getByRole("button", { name: "Cancelar" }).click();
});
await check("10. Registrar paciente nuevo aparece en la lista; el duplicado se rechaza con mensaje", async () => {
  await page.getByRole("button", { name: /Registrar paciente/ }).click();
  await page.locator("#documentType").selectOption("CC");
  await page.locator("#documentNumber").fill("77788899");
  await page.locator("#firstName").fill("Paciente");
  await page.locator("#lastName").fill("Ficticio Prueba");
  await page.locator("#email").fill("ficticio@example.com");
  await page.getByRole("button", { name: "Guardar paciente" }).click();
  await page.locator("#patients-table").getByText("Ficticio Prueba").waitFor();
  await page.getByRole("button", { name: /Registrar paciente/ }).click();
  await page.locator("#documentNumber").fill("77788899");
  await page.locator("#firstName").fill("Otro");
  await page.locator("#lastName").fill("Duplicado");
  await page.locator("#email").fill("dup@example.com");
  await page.getByRole("button", { name: "Guardar paciente" }).click();
  await page.locator("#record-error").filter({ hasText: "Ya existe un paciente" }).waitFor();
  await page.getByRole("button", { name: "Cancelar" }).click();
});
await check("11. Búsqueda filtra la lista", async () => {
  await page.locator("#patient-search").fill("Ficticio");
  await page.waitForFunction(() => document.querySelectorAll("#patients-table tbody tr").length === 1);
  await page.locator("#patient-search").fill("");
  await page.waitForFunction(() => document.querySelectorAll("#patients-table tbody tr").length === 3);
});
await check("12. Registro que desaparece (reinicio de instancia): Consultar muestra error visible y refresca la lista", async () => {
  await hit("forget-patient?id=2");
  await page.locator("#patients-table tbody tr", { hasText: "Carlos" }).getByRole("button", { name: "Consultar" }).click();
  await page.locator("#toast").filter({ hasText: "No se encontró el paciente" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("#patients-table tbody tr").length === 2);
  assert.equal(await page.locator("#modal").isHidden(), true);
});
await check("13. Navegar entre módulos y volver mantiene la sesión", async () => {
  for (const name of [/Agenda de citas/, /Catálogo de exámenes/, /Órdenes/, /Muestras/, /Resultados clínicos/, /Documentos/, /Facturación/, /Reportes/, /Usuarios y permisos/, /Auditoría/, /Pacientes/]) {
    await page.getByRole("button", { name }).first().click();
    await page.locator(".loading-state").waitFor({ state: "detached" });
    assert.equal(await page.locator(".error-panel").count(), 0, `error al abrir ${name}`);
  }
  await page.locator("#patients-table tbody tr").first().waitFor();
});
await check("14. Recargar la página conserva sesión y módulo activo", async () => {
  await page.reload();
  await page.getByRole("heading", { name: "Pacientes", exact: true }).waitFor();
});
await check("15. Sesión perdida: vuelve al login con explicación, sin panel de error ni bucle", async () => {
  await hit("revoke");
  failedRequests.length = 0;
  await page.getByRole("button", { name: /Agenda de citas/ }).click();
  await page.locator("#login-error").filter({ hasText: "ya no es válida" }).waitFor();
  assert.equal(await page.locator("#app-shell").isHidden(), true);
  assert.equal(await page.locator(".error-panel").count(), 0);
  assert.ok(failedRequests.filter(x => x.startsWith("401")).length <= 2, failedRequests.join(","));
});
await check("16. Se puede volver a entrar tras perder la sesión", async () => {
  await page.getByLabel("Correo electrónico").fill("admin@biotest.local");
  await page.getByLabel("Contraseña").fill("BioTest-Local-2026!");
  await page.getByRole("button", { name: /Ingresar al sistema/ }).click();
  await page.getByRole("heading", { name: /Agenda de citas|Panel general|Pacientes/ }).first().waitFor();
});
await check("17. Móvil (390px): Consultar y Editar funcionan", async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Abrir navegación" }).click();
  await page.getByRole("button", { name: /^Pacientes/ }).click();
  await page.locator("#patients-table tbody tr").first().getByRole("button", { name: "Consultar" }).click();
  await page.locator("#modal-title").filter({ hasText: "Expediente" }).waitFor();
  await page.locator("#edit-profile").click();
  await page.locator("#patient-form").waitFor();
  assert.ok(await page.locator("#firstName").inputValue());
  await page.getByRole("button", { name: "Cancelar" }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "desbordamiento horizontal");
});
await check("18. Cerrar sesión devuelve al acceso", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
});

await browser.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} pruebas correctas`);
if (consoleErrors.length) console.log("Errores de consola observados:", consoleErrors);
process.exit(failed.length ? 1 : 0);
