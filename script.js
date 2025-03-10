// Import Deriv API module
import DerivAPIBasic from "https://cdn.skypack.dev/@deriv/deriv-api/dist/DerivAPIBasic";

// Core variables
const index = new URLSearchParams(window.location.search).get('index') || 'R_100';
const quantity = new URLSearchParams(window.location.search).get('quantity') || 2;
const menuActive = document.getElementById(index.toLowerCase().replace('_', ''));
if (menuActive) menuActive.classList.add("menu-active");

// Initialize data arrays and trading variables
let dataPoints = [], spot = [], digit = [], time = [], tic = [], thick = [], result = [];
let balance = 100, profit = 0, autoTrade = false, apiToken = "", stake = 2, targetProfit = 100, stopLoss = 100, tradeType = "RISE_FALL";
const app_id = 69345; // Deriv App ID
const connection = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
let api = new DerivAPIBasic({ connection });
let soundEnabled = false;
let lastAlertTime = 0;
let tickCount = 0; // Track total ticks
let tradeInProgress = false; // Track trade state
let tradeStartTick = 0; // Track when trade started

// New variables for win/loss tracking and trade history
let wins = 0, losses = 0;
let tradeHistory = []; // Array to store trade records: { sequence, direction, outcome, timestamp }

// Helper functions
const toggleClass = (element, removeClass, addClass) => element && (element.classList.remove(removeClass), element.classList.add(addClass));
const isEven = value => value % 2 === 0 ? "Even" : "Odd";

// Check if CanvasJS is loaded
if (typeof CanvasJS === "undefined") {
  console.error("CanvasJS not loaded. Check script path.");
} else {
  console.log("CanvasJS loaded successfully.");
}

// Menu handling event listeners
document.querySelectorAll('.menu > span').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.menu > span').forEach(el => el.classList.remove('menu-active'));
    item.classList.add('menu-active');
    const title = item.title, newQuantity = ["R_10", "R_25"].includes(title) ? 3 : ["R_50", "R_75", "RDBEAR", "RDBULL"].includes(title) ? 4 : 2;
    window.location.href = `${window.location.pathname}?index=${title}&quantity=${newQuantity}`;
  });
});

// Chart initialization
const chart = new CanvasJS.Chart("chartContainer", {
  animationEnabled: false, theme: "light2", title: { text: "" },
  toolTip: { enabled: true, animationEnabled: true, borderColor: "#090a09", borderThickness: 2, fontColor: "#090a09", content: "{y}" },
  axisX: { includeZero: false, titleFontSize: 0, labelFontSize: 0, gridThickness: 0, tickLength: 0, lineThickness: 1, interval: 1 },
  axisY: { includeZero: false, titleFontSize: 0, labelFontSize: 0, gridThickness: 0, tickLength: 0, lineThickness: 1, interval: 1 },
  data: [{ type: "line", lineColor: "#ccc", lineThickness: 2, markerType: "circle", markerSize: 6, markerBorderThickness: 0, dataPoints }]
});
chart.render();

// Deriv API subscription request
const ticksRequest = { ticks_history: index, adjust_start_time: 1, count: 21, end: "latest", start: 1, style: "ticks", subscribe: 1 };
const tickSubscriber = () => api.subscribe(ticksRequest);

// Define levels with ranges for blue and red
const levels = {
  A: { blue: [6, 10], red: [0, 4] },
  B: { blue: [5, 9], red: [1, 5] },
  C: { blue: [4, 8], red: [2, 6] },
  D: { blue: [3, 7], red: [3, 7] },
  E: { blue: [2, 6], red: [4, 8] },
  F: { blue: [1, 5], red: [5, 9] },
  G: { blue: [0, 4], red: [6, 10] }
};

// Get the level for a given number and color
function getLevel(num, color) {
  if (!["blue", "red"].includes(color) || typeof num !== "number" || isNaN(num)) {
    console.error("Invalid color or number:", { num, color });
    return null;
  }
  for (let level in levels) {
    if (levels[level][color].includes(parseInt(num))) return level;
  }
  return null;
}

// Analyze a 5-tick sequence based on level movement with directionality
function analyze5TickTrend(sequenceStr) {
  // Split string into array of [number, color] pairs
  const ticks = [];
  for (let i = 0; i < sequenceStr.length; i += 2) {
    const num = parseInt(sequenceStr[i]);
    const color = sequenceStr[i + 1] === 'b' ? 'blue' : 'red';
    if (!isNaN(num)) ticks.push([num, color]);
  }
  if (ticks.length < 5) {
    console.log("Invalid sequence length:", ticks.length, "Sequence:", sequenceStr);
    return "Analyzing...";
  }

  const levelsSequence = ticks.map(([num, color]) => {
    const level = getLevel(num, color);
    console.log(`Mapping ${num}${color} to ${level}`);
    return level;
  });

  if (levelsSequence.includes(null) || levelsSequence.length < 5) {
    console.log("Invalid levels sequence:", levelsSequence);
    return "Analyzing...";
  }

  // Calculate level index trend
  const levelOrder = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6 };
  const indices = levelsSequence.map(level => levelOrder[level]);
  const trend = indices.reduce((acc, curr, i) => i > 0 ? acc + (curr < indices[i - 1] ? -1 : curr > indices[i - 1] ? 1 : 0) : acc, 0);
  console.log("Trend indices:", indices, "Trend value:", trend);

  // CALL: Significant upward trend with high-level presence
  const isCallTrend = trend >= 2 && levelsSequence.some(level => ['A', 'B'].includes(level));
  // PUT: Significant downward trend with low-level presence
  const isPutTrend = trend <= -2 && levelsSequence.some(level => ['E', 'F', 'G'].includes(level));

  if (isCallTrend) return "CALL";
  if (isPutTrend) return "PUT";
  return "Analyzing...";
}

// Signal generation with trade recording and cooldown
function getSignal() {
  if (digit.length < 5) {
    console.log("Digit length < 5:", digit.length);
    return;
  }
  const lastFive = digit.slice(-5).map((d, i) => {
    if (i === 0 || spot.length < 6 + i) return `${d}b`; // Default to blue if insufficient data
    const isUp = spot[spot.length - 5 + i] > spot[spot.length - 6 + i];
    return `${d}${isUp ? 'b' : 'r'}`;
  });
  console.log("Last five numbers:", lastFive.join(''));
  const signal = document.getElementById("signal");
  const now = Date.now();
  const sequenceDisplay = document.getElementById("sequence-display");

  // Check if trade is in progress (7 ticks = 14 seconds cooldown)
  if (tradeInProgress) {
    const ticksSinceTrade = tickCount - tradeStartTick;
    console.log("Trade in progress, ticks since start:", ticksSinceTrade);
    if (ticksSinceTrade < 7) return; // Wait 7 ticks
    tradeInProgress = false; // Reset after cooldown
    console.log("Trade cooldown complete, re-analyzing");
  }

  // Only evaluate signal every 5 seconds if no trade is active
  if (now - lastAlertTime < 5000) {
    console.log("Waiting for 5 seconds, time since last:", now - lastAlertTime);
    return;
  }

  const trend = analyze5TickTrend(lastFive.join(''));
  console.log("Trend calculated:", trend);
  if (trend !== "Analyzing..." && now - lastAlertTime >= 10000) {
    signal.innerHTML = trend;
    signal.classList.remove("blueb", "redb");
    if (trend === "CALL") {
      signal.classList.add("blueb");
      if (autoTrade || document.getElementById("call-button").clicked) { // Manual or auto trade
        placeTrade("CALL");
        recordTrade(lastFive.join(','), "CALL");
        tradeInProgress = true;
        tradeStartTick = tickCount;
      }
      if (soundEnabled) {
        const upSound = document.getElementById("upSound");
        upSound.play().catch(error => console.error("UP sound play failed:", error));
      }
    } else if (trend === "PUT") {
      signal.classList.add("redb");
      if (autoTrade || document.getElementById("put-button").clicked) { // Manual or auto trade
        placeTrade("PUT");
        recordTrade(lastFive.join(','), "PUT");
        tradeInProgress = true;
        tradeStartTick = tickCount;
      }
      if (soundEnabled) {
        const downSound = document.getElementById("downSound");
        downSound.play().catch(error => console.error("DOWN sound play failed:", error));
      }
    }
    sequenceDisplay.innerHTML = `${lastFive.join(',')} ${trend}`;
    sequenceDisplay.style.backgroundColor = "#ffff99";
    lastAlertTime = now;
    setTimeout(() => {
      sequenceDisplay.style.backgroundColor = "";
      sequenceDisplay.innerHTML = "";
    }, 5000);
  } else {
    signal.innerHTML = "Analyzing...";
    signal.classList.remove("blueb", "redb");
    console.log("No signal, trend:", trend, "lastAlertTime:", new Date(lastAlertTime), "now:", new Date(now));
  }
}

// Handle tick responses from Deriv API
const ticksResponse = async res => {
  const data = JSON.parse(res.data);
  if (data.error) {
    console.error("API Error:", data.error.message);
    connection.removeEventListener("message", ticksResponse);
    await api.disconnect();
    return;
  }
  if (data.msg_type === "history") {
    spot = data.history.prices.map(p => Number(p).toFixed(quantity));
    digit = spot.map(s => s.slice(-1));
    time = data.history.times;
    console.log("Historical data received:", spot, "Digit:", digit);
    updateChartsAndUI();
  }
  if (data.msg_type === "tick") {
    console.log("Tick data received:", data.tick);
    spot.push(Number(data.tick.ask).toFixed(quantity));
    digit.push(spot[spot.length - 1].slice(-1));
    time.push(data.tick.epoch);
    tickCount++; // Increment tick counter
    console.log("Tick count:", tickCount);
    if (spot.length > 21) { spot.shift(); digit.shift(); time.shift(); }
    console.log("New tick:", spot[spot.length - 1], "Digit:", digit);
    resetGridColors();
    updateGridColors();
    updateChartsAndUI();
    getSignal();
  }
};

// Update grid colors based on latest tick
function updateGridColors() {
  if (digit.length === 0 || spot.length < 2) {
    console.log("Not enough data to update grid.");
    return;
  }
  const lastDigit = digit[digit.length - 1];
  const isUp = spot[spot.length - 1] > spot[spot.length - 2];
  const color = isUp ? "toggle-blue" : "toggle-red";
  const id = `${lastDigit}-${isUp ? "blue" : "red"}`;
  const element = document.getElementById(id);
  if (element) {
    toggleClass(element, isUp ? "blue" : "red", color);
    console.log(`Grid updated: ${id} to ${color}`);
  } else {
    console.error(`Grid element not found for ID: ${id}`);
  }
};

// Reset grid colors to initial state
function resetGridColors() {
  document.querySelectorAll("table td:not(.level-label)").forEach(cell => {
    ["blue", "red", "toggle-blue", "toggle-red"].forEach(cls => cell.classList.remove(cls));
    cell.classList.add(cell.id.includes("blue") ? "blue" : "red");
  });
};

// Update charts and UI with new data
function updateChartsAndUI() {
  if (spot.length === 0) {
    console.log("No spot data available yet.");
    return;
  }
  dataPoints = spot.map((s, i) => ({
    x: i,
    y: parseFloat(s),
    indexLabel: digit[i],
    markerColor: s > (spot[i - 1] || s) ? "#29abe2" : s < (spot[i - 1] || s) ? "#c03" : "#32cd32"
  }));
  if (dataPoints.length > 21) dataPoints.shift();
  console.log("Rendering chart with dataPoints:", dataPoints);
  chart.options.data[0].dataPoints = dataPoints;
  chart.render();

  const digitsElements = document.querySelectorAll('.digits span');
  const displayCount = digitsElements.length;
  digitsElements.forEach((span, i) => {
    const idx = digit.length - displayCount + i;
    if (idx >= 0) {
      span.textContent = digit[idx];
      span.classList.remove('digits_moved_up', 'digits_moved_down');
      if (idx > 0) {
        const current = parseFloat(spot[idx]);
        const previous = parseFloat(spot[idx - 1]);
        if (current > previous) {
          span.classList.add('digits_moved_up');
        } else if (current < previous) {
          span.classList.add('digits_moved_down');
        }
      }
    } else {
      span.textContent = '';
    }
  });
};

// Place a trade via Deriv API
async function placeTrade(type) {
  if (!apiToken) return;
  try {
    // REPLACE THIS BLOCK WITH NEW DERIV API BUY CALL WHEN YOU GET YOUR UPDATED API CODE
    const response = await api.buy({
      buy: 1, price: stake, parameters: { contract_type: type, symbol: index, duration: 5, duration_unit: "t", basis: "stake", currency: "USD", amount: stake }
    });
    console.log("Trade placed:", response);
  } catch (error) {
    console.error("Trade error:", error);
  }
};

// Download trade history as CSV
function downloadCSV() {
  const headers = "Sequence,Direction,Outcome,Timestamp\n";
  const rows = tradeHistory.map(trade => `${trade.sequence},${trade.direction},${trade.outcome},${new Date(trade.timestamp).toISOString()}`).join("\n");
  const csv = headers + rows;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trades.csv";
  a.click();
  window.URL.revokeObjectURL(url);
};

// Event listeners for user interactions
document.getElementById("call-button").addEventListener("click", () => placeTrade("CALL"));
document.getElementById("put-button").addEventListener("click", () => placeTrade("PUT"));
document.getElementById("update-trading-params").addEventListener("click", () => {
  stake = parseFloat(document.getElementById("stake").value) || 2;
  targetProfit = parseFloat(document.getElementById("target-profit").value) || 100;
  stopLoss = parseFloat(document.getElementById("stop-loss").value) || 100;
});
document.getElementById("trade-type-select").addEventListener("change", e => tradeType = e.target.value);
document.getElementById("api-token-button").addEventListener("click", () => {
  apiToken = document.getElementById("api-token-input").value.trim();
  if (apiToken) {
    connection.close();
    connection = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
    api = new DerivAPIBasic({ connection });
    connection.addEventListener("open", async () => {
      console.log("Connection opened"); // Debug connection
      await api.authorize({ authorize: apiToken });
      tickSubscriber();
    });
    connection.addEventListener("message", ticksResponse);
  }
});
document.getElementById("toggle-trade").addEventListener("click", () => {
  autoTrade = !autoTrade;
  document.getElementById("toggle-trade").innerHTML = `Toggle Auto-Trading (${autoTrade ? "ON" : "OFF"})`;
});
document.getElementById("sound-toggle").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  document.getElementById("sound-toggle").textContent = `Sound: ${soundEnabled ? "ON" : "OFF"}`;
  // Prevent layout shift by ensuring order
  const container = document.querySelector('.trading-system');
  if (container) container.style.flexDirection = 'row'; // Force row layout
});
document.getElementById("download-csv").addEventListener("click", downloadCSV);

// Update custom clock every second
setInterval(() => {
  const customClock = document.getElementById("custom-clock");
  if (customClock) {
    customClock.textContent = new Date().toUTCString();
    customClock.style.color = "#333333";
    customClock.style.backgroundColor = "transparent";
    customClock.style.border = "none";
    customClock.style.padding = "5px";
    customClock.style.fontWeight = "bold";
  } else {
    console.error("Custom clock element not found!");
  }
}, 1000);

// Start API subscription
connection.addEventListener("open", () => tickSubscriber());
connection.addEventListener("message", ticksResponse);
