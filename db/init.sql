CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(140) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'reception',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','reception','lab','health'));

CREATE TABLE IF NOT EXISTS patients (
  id BIGSERIAL PRIMARY KEY,
  document_type VARCHAR(20) NOT NULL,
  document_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(40),
  birth_date DATE,
  sex VARCHAR(20),
  address VARCHAR(240),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_type, document_number)
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  service VARCHAR(120) NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Programada',
  notes VARCHAR(500),
  created_by BIGINT REFERENCES users(id),
  professional_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_date, appointment_time, patient_id)
);
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check CHECK (status IN ('Programada','Confirmada','Atendida','Cancelada','No asistió','En atención','Completada'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS professional_id BIGINT REFERENCES users(id);
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_appointment_date_appointment_time_patient_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_patient_slot_active ON appointments (patient_id, appointment_date, appointment_time) WHERE status NOT IN ('Cancelada','No asistió');
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_professional_slot_active ON appointments (professional_id, appointment_date, appointment_time) WHERE professional_id IS NOT NULL AND status NOT IN ('Cancelada','No asistió');

CREATE TABLE IF NOT EXISTS exam_catalog (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL UNIQUE,
  category VARCHAR(80) NOT NULL,
  sample_type VARCHAR(100) NOT NULL,
  preparation TEXT NOT NULL DEFAULT '',
  turnaround_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (turnaround_minutes > 0),
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  unit VARCHAR(50) NOT NULL DEFAULT '',
  reference_range VARCHAR(120) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number VARCHAR(40) NOT NULL UNIQUE,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  status VARCHAR(30) NOT NULL DEFAULT 'Pendiente de toma',
  reason VARCHAR(300) NOT NULL DEFAULT '',
  ordered_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS samples (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  sample_type VARCHAR(100) NOT NULL,
  collected_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'Pendiente de toma',
  observations VARCHAR(500),
  created_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  order_id BIGINT REFERENCES lab_orders(id),
  sample_code VARCHAR(40) UNIQUE,
  received_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);
ALTER TABLE samples ALTER COLUMN collected_at DROP NOT NULL;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS order_id BIGINT REFERENCES lab_orders(id);
ALTER TABLE samples ADD COLUMN IF NOT EXISTS sample_code VARCHAR(40);
ALTER TABLE samples ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE samples DROP CONSTRAINT IF EXISTS samples_status_check;
ALTER TABLE samples ADD CONSTRAINT samples_status_check CHECK (status IN ('Pendiente de toma','Recolectada','Recibida','En procesamiento','Procesada','Finalizada','Rechazada','Cancelada'));

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  exam_id BIGINT NOT NULL REFERENCES exam_catalog(id),
  sample_id BIGINT REFERENCES samples(id),
  status VARCHAR(24) NOT NULL DEFAULT 'Pendiente',
  result_value VARCHAR(180) NOT NULL DEFAULT '',
  unit VARCHAR(50) NOT NULL DEFAULT '',
  reference_range VARCHAR(120) NOT NULL DEFAULT '',
  result_flag VARCHAR(24) NOT NULL DEFAULT '',
  processing_by BIGINT REFERENCES users(id),
  validated_by BIGINT REFERENCES users(id),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, exam_id),
  CHECK (status IN ('Pendiente','En revisión','Validado','Publicado','Corregido'))
);

CREATE TABLE IF NOT EXISTS result_corrections (
  id BIGSERIAL PRIMARY KEY,
  order_item_id BIGINT NOT NULL REFERENCES order_items(id),
  previous_value VARCHAR(180) NOT NULL,
  corrected_value VARCHAR(180) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  actor_id BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  invoice_number VARCHAR(40) NOT NULL UNIQUE,
  order_id BIGINT NOT NULL UNIQUE REFERENCES lab_orders(id),
  patient_id BIGINT NOT NULL REFERENCES patients(id),
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0 AND amount_paid <= subtotal),
  status VARCHAR(24) NOT NULL DEFAULT 'Pendiente',
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  CHECK (status IN ('Pendiente','Pagado','Anulado','Parcial'))
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0 AND amount_paid <= subtotal);

CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  document_type VARCHAR(60) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  patient_id BIGINT REFERENCES patients(id),
  order_id BIGINT REFERENCES lab_orders(id),
  responsible_id BIGINT REFERENCES users(id),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_name ON patients (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments (appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_samples_status ON samples (status, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_patient ON lab_orders (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_result_corrections_item ON result_corrections (order_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_patient ON documents (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

INSERT INTO exam_catalog (code,name,category,sample_type,preparation,turnaround_minutes,price,unit,reference_range)
VALUES
('HEM-001','Hemograma completo','Hematología','Sangre total','No requiere ayuno, salvo indicación clínica.',240,28000,'',''),
('QUI-001','Glucosa en ayunas','Química clínica','Suero','Ayuno según indicación del profesional solicitante.',180,12000,'mg/dL','Configurable por el laboratorio'),
('QUI-002','Perfil lipídico','Química clínica','Suero','Ayuno según protocolo del laboratorio.',300,42000,'','Configurable por el laboratorio'),
('QUI-003','Creatinina sérica','Química clínica','Suero','Informar medicamentos relevantes al profesional.',180,16000,'mg/dL','Configurable por el laboratorio'),
('INM-001','TSH','Hormonas','Suero','Informar medicamentos y tratamientos en curso.',360,38000,'µUI/mL','Configurable por el laboratorio'),
('INM-002','Antígeno de superficie hepatitis B','Inmunología y serología','Suero','No requiere preparación específica general.',360,32000,'',''),
('MIC-001','Urocultivo','Microbiología','Orina','Recolectar según instrucciones de toma de muestra.',2880,52000,'',''),
('URO-001','Uroanálisis','Uroanálisis','Orina','Usar recipiente adecuado y seguir instrucciones de recolección.',180,14000,'',''),
('COP-001','Coprológico','Coprología','Materia fecal','Recolectar en recipiente adecuado evitando contaminación.',240,18000,'',''),
('HEM-002','Hemoglobina glicosilada (HbA1c)','Química clínica','Sangre total','No suele requerir ayuno; confirmar indicación clínica.',360,36000,'%','Configurable por el laboratorio')
ON CONFLICT (code) DO NOTHING;
