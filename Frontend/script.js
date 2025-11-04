/* frontend script.js
 * - Polls backend for sensors
 * - Shows equipment list, sensor JSON, prediction, alerts, work orders
 * - Uses Chart.js for trend plotting
 * - Now includes Maintenance Alert if temperature >75°C or vibration >2.5
 */

const API_BASE = "https://predictive-maintenance-iiot.onrender.com"; // ✅ updated to Render URL

let selectedEquipmentId = null;
const equipmentListEl = document.getElementById("equipment-list");
const sensorJsonEl = document.getElementById("sensor-json");
const predStatusEl = document.getElementById("pred-status");
const predProbEl = document.getElementById("pred-prob");
const alertListEl = document.getElementById("alert-list");
const workordersEl = document.getElementById("workorders");

const titleEl = document.getElementById("title");
const chartCtx = document.getElementById("chart").getContext("2d");

const lineChart = new Chart(chartCtx, {
  type: "line",
  data: {
    labels: [],
    datasets: [
      { label: "Temperature (°C)", data: [], borderColor: "#3b82f6", fill: false },
      { label: "Vibration (mm/s)", data: [], borderColor: "#f59e0b", fill: false }
    ]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: true } },
    scales: { y: { beginAtZero: false } }
  }
});

// load equipment list
async function loadEquipment() {
  const res = await fetch(`${API_BASE}/equipment`);
  const items = await res.json();
  equipmentListEl.innerHTML = "";
  items.forEach(eq => {
    const li = document.createElement("li");
    li.textContent = `${eq.name} (${eq.id})`;
    li.onclick = () => selectEquipment(eq.id, eq.name);
    equipmentListEl.appendChild(li);
  });
}

// select equipment
function selectEquipment(id, name) {
  selectedEquipmentId = id;
  titleEl.textContent = `${name} — ${id}`;
  // clear chart
  lineChart.data.labels = [];
  lineChart.data.datasets.forEach(ds => ds.data = []);
  lineChart.update();
  // fetch immediate
  fetchAndUpdate();
}

// fetch sensors & prediction & alerts & maintenance
async function fetchAndUpdate() {
  try {
    // sensors (all)
    const sres = await fetch(`${API_BASE}/sensors`);
    const sensors = await sres.json();

    // alerts
    const ares = await fetch(`${API_BASE}/alerts`);
    const alerts = await ares.json();
    renderAlerts(alerts);

    // if nothing selected, show overall
    if (!selectedEquipmentId) {
      sensorJsonEl.textContent = JSON.stringify(sensors.slice(0,3), null, 2);
      predStatusEl.textContent = "--"; predProbEl.textContent = "--";
      return;
    }

    // get specific sensor
    const res = await fetch(`${API_BASE}/sensor/${selectedEquipmentId}`);
    const reading = await res.json();
    sensorJsonEl.textContent = JSON.stringify(reading, null, 2);

    // prediction
    const pres = await fetch(`${API_BASE}/predict/${selectedEquipmentId}`, { method: "POST" });
    const pred = await pres.json();
    predStatusEl.textContent = pred.status;
    predProbEl.textContent = (pred.failure_probability ?? 0).toFixed(2);

    // style status
    predStatusEl.style.background =
      pred.status === "Critical" ? "#ef4444" :
      pred.status === "Warning" ? "#f59e0b" : "#10b981";

    // 🚨 Maintenance Alert logic
    if (reading.temperature > 75 || reading.vibration > 2.5) {
      const alertMsg = `⚠️ Maintenance Alert: ${selectedEquipmentId} — Temp: ${reading.temperature}°C, Vib: ${reading.vibration} mm/s`;
      console.warn(alertMsg);

      // show toast alert in UI
      const alertDiv = document.createElement("div");
      alertDiv.textContent = alertMsg;
      alertDiv.style.position = "fixed";
      alertDiv.style.bottom = "10px";
      alertDiv.style.right = "10px";
      alertDiv.style.padding = "10px 15px";
      alertDiv.style.background = "#ef4444";
      alertDiv.style.color = "white";
      alertDiv.style.borderRadius = "8px";
      alertDiv.style.zIndex = "9999";
      document.body.appendChild(alertDiv);
      setTimeout(() => alertDiv.remove(), 4000);

      // send to backend as new alert
      await fetch(`${API_BASE}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipmentId: selectedEquipmentId,
          level: "Critical",
          message: alertMsg
        })
      });
    }

    // update chart
    const now = new Date().toLocaleTimeString();
    lineChart.data.labels.push(now);
    lineChart.data.datasets[0].data.push(reading.temperature);
    lineChart.data.datasets[1].data.push(reading.vibration);
    if (lineChart.data.labels.length > 20) {
      lineChart.data.labels.shift();
      lineChart.data.datasets.forEach(ds => ds.data.shift());
    }
    lineChart.update();

    // load work orders
    const wres = await fetch(`${API_BASE}/maintenance`);
    const w = await wres.json();
    renderWorkorders(w.filter(x => x.equipmentId === selectedEquipmentId));
  } catch (err) {
    console.error("Update error", err);
  }
}

function renderAlerts(alerts) {
  alertListEl.innerHTML = "";
  alerts.slice(0,6).forEach(a => {
    const li = document.createElement("li");
    li.textContent = `${a.level} - ${a.equipmentId}: ${a.message}`;
    // ack button
    const btn = document.createElement("button");
    btn.textContent = "Acknowledge";
    btn.style.marginLeft = "8px";
    btn.onclick = async (e) => {
      e.stopPropagation();
      await fetch(`${API_BASE}/alerts/${a.id}/ack`, { method: "POST" });
      loadAlertsOnce();
    };
    li.appendChild(btn);
    alertListEl.appendChild(li);
  });
}

async function loadAlertsOnce() {
  const ares = await fetch(`${API_BASE}/alerts`);
  const alerts = await ares.json();
  renderAlerts(alerts);
}

function renderWorkorders(arr) {
  workordersEl.innerHTML = "";
  arr.forEach(w => {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${w.title}</strong><div style="font-size:12px;color:#9fbcd8">${new Date(w.createdAt).toLocaleString()}</div></div>
      <div>
        <small style="margin-right:8px">${w.status}</small>
        ${w.status === "Open" ? `<button data-id="${w.id}" class="close-wo">Close</button>` : ""}
      </div>`;
    workordersEl.appendChild(li);
  });
  // attach close handlers
  document.querySelectorAll(".close-wo").forEach(b => {
    b.onclick = async (e) => {
      const id = e.target.getAttribute("data-id");
      await fetch(`${API_BASE}/workorder/${id}/close`, { method: "POST" });
      fetchAndUpdate();
    };
  });
}

// create new maintenance
document.getElementById("btn-create").onclick = async () => {
  const title = document.getElementById("wo-title").value.trim();
  const notes = document.getElementById("wo-notes").value.trim();
  if (!selectedEquipmentId) { alert("Select equipment first"); return; }
  if (!title) { alert("Title required"); return; }
  await fetch(`${API_BASE}/maintenance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ equipmentId: selectedEquipmentId, title, notes })
  });
  document.getElementById("wo-title").value = ""; 
  document.getElementById("wo-notes").value = "";
  fetchAndUpdate();
};

// quick create work order button
document.getElementById("btn-create-workorder").onclick = () => {
  const suggested = `Inspect ${selectedEquipmentId}`;
  document.getElementById("wo-title").value = suggested;
  document.getElementById("wo-notes").value = "Auto-created from dashboard";
};

// refresh handlers
document.getElementById("btn-refresh").onclick = fetchAndUpdate;

// initial load
loadEquipment();
loadAlertsOnce();
setInterval(fetchAndUpdate, 2000);
