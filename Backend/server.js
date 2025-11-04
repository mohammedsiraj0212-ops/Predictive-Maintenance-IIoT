/**
 * Predictive Maintenance Backend
 * - Simulates multiple equipment sensor streams
 * - Provides REST endpoints for sensor data, prediction, equipment list, alerts, maintenance
 *
 * Run:
 *   npm install
 *   npm run dev
 */

const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

// ---------- In-memory DB (simple for demo) ----------
const equipment = [
  { id: "EQ-001", name: "Pump A1", type: "Pump", location: "Plant 1", model: "P100", warranty: "2026-06-30" },
  { id: "EQ-002", name: "Compressor B2", type: "Compressor", location: "Plant 2", model: "C200", warranty: "2027-01-12" },
  { id: "EQ-003", name: "Motor M3", type: "Motor", location: "Plant 1", model: "M300", warranty: "2025-11-02" }
];

const maintenanceLogs = []; // {id, equipmentId, title, notes, createdAt, status}
const alerts = []; // {id, equipmentId, level, message, createdAt, acknowledged}

// sensorState keeps last sensor readings
const sensorState = {};

// initialize sensors
equipment.forEach(eq => {
  sensorState[eq.id] = generateSensorReading(eq.id);
});

// ---------- Utility functions ----------
function rand(min, max) {
  return min + Math.random() * (max - min);
}

function generateSensorReading(equipmentId) {
  // Simple simulated sensors: temperature(°C), vibration(mm/s), pressure(bar), rpm
  return {
    equipmentId,
    timestamp: Date.now(),
    temperature: +(60 + Math.random() * 50).toFixed(2), // 60 - 110
    vibration: +(0.5 + Math.random() * 6).toFixed(2),   // 0.5 - 6.5
    pressure: +(1 + Math.random() * 9).toFixed(2),      // 1 - 10
    rpm: Math.round(800 + Math.random() * 1600)         // 800 - 2400
  };
}

// Simple predictive score: normalized weighted sum
function predictFromReading(reading) {
  // weights (tunable)
  const wTemp = 0.4;
  const wVib = 0.35;
  const wPres = 0.15;
  const wRpm = 0.1;

  // normalize values to 0..1 by expected max values
  const tempNorm = Math.min(reading.temperature / 120, 1);
  const vibNorm = Math.min(reading.vibration / 10, 1);
  const presNorm = Math.min(reading.pressure / 12, 1);
  const rpmNorm = Math.min(reading.rpm / 3000, 1);

  const score = tempNorm * wTemp + vibNorm * wVib + presNorm * wPres + rpmNorm * wRpm;
  // convert to probability 0..1 (rough)
  const failure_probability = Math.min(Math.max(score, 0), 1);
  let status = "Healthy";
  if (failure_probability > 0.75) status = "Critical";
  else if (failure_probability > 0.5) status = "Warning";

  return { failure_probability: +failure_probability.toFixed(2), status };
}

// generate alert if thresholds/prediction exceed
function maybeGenerateAlert(equipmentId, reading, prediction) {
  if (prediction.failure_probability >= 0.75 || reading.vibration > 5 || reading.temperature > 105) {
    const level = prediction.failure_probability >= 0.75 ? "Critical" : "High";
    const message = `Detected ${level} condition: temp=${reading.temperature}°C vib=${reading.vibration} mm/s`;
    const alert = {
      id: uuidv4(),
      equipmentId,
      level,
      message,
      createdAt: Date.now(),
      acknowledged: false
    };
    alerts.unshift(alert); // newest first
    // keep small
    if (alerts.length > 200) alerts.pop();
    return alert;
  }
  return null;
}

// ---------- Periodic sensor simulation ----------
setInterval(() => {
  // update sensors for each equipment
  equipment.forEach(eq => {
    // small random walk from previous value
    const prev = sensorState[eq.id] || generateSensorReading(eq.id);
    const newReading = {
      equipmentId: eq.id,
      timestamp: Date.now(),
      temperature: +Math.max(20, Math.min(130, +(prev.temperature + rand(-2.5, 3.5)).toFixed(2))).toFixed(2),
      vibration: +Math.max(0.1, Math.min(12, +(prev.vibration + rand(-0.5, 0.6)).toFixed(2))).toFixed(2),
      pressure: +Math.max(0.5, Math.min(15, +(prev.pressure + rand(-0.4, 0.5)).toFixed(2))).toFixed(2),
      rpm: Math.max(200, Math.min(4000, Math.round(prev.rpm + rand(-80, 120))))
    };
    sensorState[eq.id] = newReading;

    // compute prediction & maybe create alerts
    const pred = predictFromReading(newReading);
    maybeGenerateAlert(eq.id, newReading, pred);
  });
}, 2000); // every 2s

// ---------- API endpoints ----------

// GET / -> simple info
app.get("/", (req, res) => {
  res.json({ message: "Predictive Maintenance API (Express) running" });
});

// GET /equipment -> list all equipment
app.get("/equipment", (req, res) => {
  res.json(equipment);
});

// GET /sensor/:id -> latest sensor reading for an equipment
app.get("/sensor/:id", (req, res) => {
  const id = req.params.id;
  const data = sensorState[id];
  if (!data) return res.status(404).json({ error: "Equipment not found" });
  res.json(data);
});

// GET /sensors -> latest readings for all equipment
app.get("/sensors", (req, res) => {
  const arr = Object.values(sensorState).sort((a,b)=>b.timestamp-a.timestamp);
  res.json(arr);
});

// POST /predict/:id -> predict from the current reading for equipment id
app.post("/predict/:id", (req, res) => {
  const id = req.params.id;
  const reading = sensorState[id];
  if (!reading) return res.status(404).json({ error: "Equipment not found" });
  const result = predictFromReading(reading);
  res.json({ ...result, reading });
});

// GET /alerts -> list alerts
app.get("/alerts", (req, res) => {
  res.json(alerts);
});

// POST /alerts/:id/ack -> acknowledge alert
app.post("/alerts/:id/ack", (req, res) => {
  const id = req.params.id;
  const a = alerts.find(x => x.id === id);
  if (!a) return res.status(404).json({ error: "Alert not found" });
  a.acknowledged = true;
  res.json(a);
});

// GET /maintenance -> list logs
app.get("/maintenance", (req, res) => {
  res.json(maintenanceLogs);
});

// POST /maintenance -> create new maintenance order
app.post("/maintenance", (req, res) => {
  const { equipmentId, title, notes } = req.body;
  if (!equipmentId || !title) return res.status(400).json({ error: "equipmentId & title required" });
  const item = {
    id: uuidv4(),
    equipmentId,
    title,
    notes: notes || "",
    status: "Open",
    createdAt: Date.now()
  };
  maintenanceLogs.unshift(item);
  res.json(item);
});

// POST /workorder/:id/close -> close maintenance
app.post("/workorder/:id/close", (req, res) => {
  const id = req.params.id;
  const it = maintenanceLogs.find(m => m.id === id);
  if (!it) return res.status(404).json({ error: "Work order not found" });
  it.status = "Closed";
  res.json(it);
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Predictive Maintenance Backend running on port ${PORT}`);
});
