import { test, expect } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL || "admin@biotest.local";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "BioTest-Local-2026!";

async function login(page, email=adminEmail, password=adminPassword) {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: /Ingresar al sistema/ }).click();
}
test("la página de acceso presenta el formulario institucional", async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {name:"Iniciar sesión"})).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
});
test("credenciales inválidas no permiten el acceso", async ({page}) => {
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(adminEmail);
  await page.getByLabel("Contraseña").fill("una-clave-incorrecta");
  await page.getByRole("button", {name:/Ingresar al sistema/}).click();
  await expect(page.getByRole("alert")).toContainText("Credenciales incorrectas");
});
test("el administrador accede al panel y a la gestión de pacientes", async ({page}) => {
  await login(page);
  await expect(page.getByRole("heading", {name:"Panel general"})).toBeVisible();
  await page.getByRole("button", {name:/Pacientes/}).click();
  await expect(page.getByRole("heading", {name:"Pacientes"})).toBeVisible();
  await expect(page.getByRole("button", {name:/Registrar paciente/})).toBeVisible();
});
test("el formulario de paciente exige los campos obligatorios", async ({page}) => {
  await login(page);
  await page.getByRole("button", {name:/Pacientes/}).click();
  await page.getByRole("button", {name:/Registrar paciente/}).click();
  await page.getByRole("button", {name:"Guardar paciente"}).click();
  await expect(page.locator("#firstName")).toHaveAttribute("required", "");
});
test("el sistema conserva la sesión tras navegar entre módulos", async ({page}) => {
  await login(page);
  await page.getByRole("button", {name:/Pacientes/}).click();
  await page.getByRole("button", {name:/Agenda de citas/}).click();
  await expect(page.getByRole("heading", {name:"Agenda de citas"})).toBeVisible();
});
test("cerrar sesión devuelve al formulario de acceso", async ({page}) => {
  await login(page);
  await page.getByRole("button", {name:"Cerrar sesión"}).click();
  await expect(page.getByRole("heading", {name:"Iniciar sesión"})).toBeVisible();
});


test("la pantalla de acceso identifica el grupo académico solicitado", async ({page}) => {
  await page.goto("/");
  await expect(page.getByText("Grupo 27, calidad de software").first()).toBeVisible();
});

test("el panel muestra los nuevos módulos operativos sin controles de QA", async ({page}) => {
  await login(page);
  await expect(page.getByRole("heading", {name:"Panel general"})).toBeVisible();
  await expect(page.getByRole("button", {name:/Catálogo de exámenes/})).toBeVisible();
  await expect(page.getByRole("button", {name:/Órdenes/})).toBeVisible();
  await expect(page.getByRole("button", {name:/Muestras/})).toBeVisible();
  await expect(page.getByRole("button", {name:/Resultados clínicos/})).toBeVisible();
  await expect(page.getByText(/Ejecutar caso|Ejecutar prueba|Test QA/i)).toHaveCount(0);
});

async function callApi(page, path, method = "GET", body = undefined) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    return { status: response.status, body: payload };
  }, { path, method, body });
}

test("el flujo conectado paciente, orden, muestra, resultado e importe es coherente", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString();
  const patientPayload = {
    documentType: "CC", documentNumber: `E2E${stamp}`, firstName: "Paciente", lastName: `Automatizado ${stamp.slice(-5)}`,
    email: `e2e-${stamp}@biotest.local`, phone: "3000000000", birthDate: "2000-01-15", sex: "No especifica", address: ""
  };
  const createdPatient = await callApi(page, "/api/patients", "POST", patientPayload);
  expect(createdPatient.status).toBe(201);
  const duplicatePatient = await callApi(page, "/api/patients", "POST", patientPayload);
  expect(duplicatePatient.status).toBe(409);

  const examsResponse = await callApi(page, "/api/exams");
  expect(examsResponse.status).toBe(200);
  const exam = examsResponse.body.exams.find(item => item.active && Number(item.price) > 0);
  expect(exam).toBeTruthy();
  const createdOrder = await callApi(page, "/api/orders", "POST", {
    patientId: createdPatient.body.patient.id, examIds: [exam.id], reason: "Solicitud de atención"
  });
  expect(createdOrder.status).toBe(201);
  expect(createdOrder.body.samples).toHaveLength(1);

  const sampleId = createdOrder.body.samples[0].id;
  for (const status of ["Recolectada", "Recibida", "En procesamiento", "Procesada"]) {
    const changed = await callApi(page, `/api/samples/${sampleId}/status`, "PATCH", { status });
    expect(changed.status).toBe(200);
    expect(changed.body.sample.status).toBe(status);
  }

  const results = await callApi(page, `/api/results?search=${encodeURIComponent(createdOrder.body.order.orderNumber)}`);
  expect(results.status).toBe(200);
  const resultItem = results.body.results.find(item => Number(item.orderId) === Number(createdOrder.body.order.id));
  expect(resultItem).toBeTruthy();
  const entered = await callApi(page, `/api/results/${resultItem.id}`, "POST", { resultValue: "13.4" });
  expect(entered.status).toBe(200);
  expect(entered.body.result.status).toBe("En revisión");
  const validated = await callApi(page, `/api/results/${resultItem.id}/review`, "PATCH", { status: "Validado" });
  expect(validated.status).toBe(200);
  const published = await callApi(page, `/api/results/${resultItem.id}/review`, "PATCH", { status: "Publicado" });
  expect(published.status).toBe(200);

  const orderAfterPublish = await callApi(page, `/api/orders?search=${encodeURIComponent(createdOrder.body.order.orderNumber)}`);
  expect(orderAfterPublish.body.orders[0].status).toBe("Finalizada");
  const createdInvoice = await callApi(page, "/api/invoices", "POST", { orderId: createdOrder.body.order.id });
  expect(createdInvoice.status).toBe(201);
  const total = Number(createdInvoice.body.invoice.subtotal);
  const partial = Math.round(total / 2 * 100) / 100;
  const changedInvoice = await callApi(page, `/api/invoices/${createdInvoice.body.invoice.id}/status`, "PATCH", { status: "Parcial", amountPaid: partial });
  expect(changedInvoice.status).toBe(200);
  expect(Number(changedInvoice.body.invoice.amountPaid)).toBe(partial);
});

test("los permisos se validan en el servidor además de ocultar la navegación", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString();
  const email = `lab-e2e-${stamp}@biotest.local`;
  const password = `E2E-Lab-${stamp.slice(-6)}-Safe!`;
  const created = await callApi(page, "/api/users", "POST", {
    fullName: `Laboratorista E2E ${stamp.slice(-5)}`, email, password, role: "lab"
  });
  expect(created.status).toBe(201);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await login(page, email, password);
  await expect(page.getByRole("button", { name: "Usuarios y permisos" })).toBeHidden();
  const deniedCatalogWrite = await callApi(page, "/api/exams", "POST", {
    code: `E2E-${stamp.slice(-6)}`, name: `Examen E2E ${stamp.slice(-5)}`, category: "Pruebas especiales",
    sampleType: "Suero", preparation: "", turnaroundMinutes: 120, price: 0, unit: "", referenceRange: ""
  });
  expect(deniedCatalogWrite.status).toBe(403);
  const deniedReports = await callApi(page, "/api/reports/summary");
  expect(deniedReports.status).toBe(403);
  const deniedPatientList = await callApi(page, "/api/patients");
  expect(deniedPatientList.status).toBe(403);
  const deniedAppointments = await callApi(page, "/api/appointments");
  expect(deniedAppointments.status).toBe(403);
});

test("/api/auth/local-access existe y responde 200 (nunca 404) con un indicador de disponibilidad", async ({ page }) => {
  await page.goto("/");
  const response = await callApi(page, "/api/auth/local-access");
  expect(response.status).toBe(200);
  expect(typeof response.body.available).toBe("boolean");
  expect(response.body.password).toBeUndefined();
});

test("una ruta de API inexistente devuelve JSON 404, no la página HTML", async ({ page }) => {
  await login(page);
  const response = await callApi(page, "/api/ruta-que-no-existe");
  expect(response.status).toBe(404);
  expect(response.body.code).toBe("ROUTE_NOT_FOUND");
});

test("sin sesión las rutas protegidas responden 401 con un mensaje claro y la interfaz vuelve al acceso", async ({ page }) => {
  await page.goto("/");
  const response = await callApi(page, "/api/dashboard");
  expect(response.status).toBe(401);
  expect(response.body.error).toBeTruthy();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
});

test("pacientes: registrar, consultar, editar y ver los cambios reflejados", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString();
  const documentNumber = `UI${stamp}`;
  const created = await callApi(page, "/api/patients", "POST", {
    documentType: "CC", documentNumber, firstName: "Paciente", lastName: `Ficticio ${stamp.slice(-5)}`,
    email: `ui-${stamp}@example.com`, phone: "3000000000", birthDate: "1991-03-09", sex: "Femenino", address: ""
  });
  expect(created.status).toBe(201);

  await page.getByRole("button", { name: /^Pacientes/ }).click();
  await page.locator("#patient-search").fill(documentNumber);
  const row = page.locator("#patients-table tbody tr").filter({ hasText: documentNumber });
  await expect(row).toHaveCount(1);

  // Consultar: muestra el paciente correcto
  await row.getByRole("button", { name: "Consultar" }).click();
  await expect(page.locator("#modal-title")).toContainText("Expediente del paciente");
  await expect(page.locator("#modal-body")).toContainText(documentNumber.toUpperCase());
  await page.locator("#modal-body [data-close-modal]").click();

  // Editar: el formulario trae los datos actuales y valida
  await row.getByRole("button", { name: "Editar" }).click();
  await expect(page.locator("#documentNumber")).toHaveValue(documentNumber.toUpperCase());
  await expect(page.locator("#birthDate")).toHaveValue("1991-03-09");
  await page.locator("#firstName").fill("A");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator("#record-error")).toContainText("Nombres");

  // Editar: guarda de verdad y se refleja en la lista y en la consulta
  await page.locator("#firstName").fill("Nombre Editado");
  await page.locator("#phone").fill("3119998877");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator("#toast")).toContainText("Los datos del paciente se actualizaron.");
  await page.locator("#patient-search").fill(documentNumber);
  const updatedRow = page.locator("#patients-table tbody tr").filter({ hasText: documentNumber });
  await expect(updatedRow).toContainText("Nombre Editado");
  await expect(updatedRow).toContainText("3119998877");
  await updatedRow.getByRole("button", { name: "Consultar" }).click();
  await expect(page.locator("#modal-body")).toContainText("Nombre Editado");
  await expect(page.locator("#modal-body")).toContainText("3119998877");

  const fetched = await callApi(page, `/api/patients/${created.body.patient.id}`);
  expect(fetched.body.patient.firstName).toBe("Nombre Editado");
  expect(fetched.body.patient.birthDate).toBe("1991-03-09");
});

test("consultar un paciente inexistente devuelve 404 con mensaje", async ({ page }) => {
  await login(page);
  const response = await callApi(page, "/api/patients/99999999");
  expect(response.status).toBe(404);
  expect(response.body.error).toContain("paciente");
  const invalid = await callApi(page, "/api/patients/abc");
  expect(invalid.status).toBe(400);
});

test("la sesión se mantiene tras varias consultas seguidas al panel", async ({ page }) => {
  await login(page);
  for (let i = 0; i < 5; i++) {
    const response = await callApi(page, "/api/dashboard");
    expect(response.status).toBe(200);
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: "Panel general" })).toBeVisible();
});
