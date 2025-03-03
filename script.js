// Import Deriv API module
import DerivAPIBasic from "https://cdn.skypack.dev/@deriv/deriv-api/dist/DerivAPIBasic";

// Core variables
const index = new URLSearchParams(window.location.search).get('index') || 'R_100';
const quantity = new URLSearchParams(window.location.search).get('quantity') || 2;
const menuActive = document.getElementById(index.toLowerCase().replace('_', ''));
if (menuActive) menuActive.classList.add("menu-active");

// Initialize data arrays and trading variables
let dataPoints = [], spot = [], digit = [], time = [], tic = [], thick = [], result = [];
let balance = 100, profit = 0, autoTrade = false, apiToken = "", stake = 2, targetProfit = 10000, stopLoss = 1000, tradeType = "RISE_FALL";
const app_id = 69345; // Deriv App ID (replace with your own if needed)
const connection = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
let api = new DerivAPIBasic({ connection });
let soundEnabled = false;
let lastAlertTime = 0;

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

// Trend analysis function with parity pattern check
function analyzeTrend(lastFiveNumbers) {
  const levels = { A: { blue: [6, 10], red: [0, 4] }, B: { blue: [5, 9], red: [1, 5] }, C: { blue: [4, 8], red: [2, 6] },
    D: { blue: [3, 7], red: [3, 7] }, E: { blue: [2, 6], red: [4, 8] }, F: { blue: [1, 5], red: [5, 9] }, G: { blue: [0, 4], red: [6, 10] } };

  const getLevel = (num, color) => {
    for (let level in levels)
      if (levels[level][color].includes(parseInt(num))) return level;
    return null;
  };

  const convertToDifferenceOfOne = pair => {
    let [n1, c1] = pair[0].split(''), [n2, c2] = pair[1].split('');
    n1 = parseInt(n1); n2 = parseInt(n2);
    if (Math.abs(n1 - n2) === 1) return pair;
    const level = getLevel(n1, c1 === 'b' ? 'blue' : 'red');
    const equivs = levels[level][c1 === 'b' ? 'blue' : 'red'].concat(levels[level][c1 === 'b' ? 'red' : 'blue']);
    for (let equiv of equivs)
      if (Math.abs(equiv - n2) === 1) return [`${equiv}${c1}`, pair[1]];
    return pair;
  };

  const getPairTrend = (pair) => {
    let [n1, c1] = pair[0].split(''), [n2, c2] = pair[1].split('');
    n1 = parseInt(n1); n2 = parseInt(n2);
    const parity1 = isEven(n1), parity2 = isEven(n2);
    if (c1 !== c2 && parity1 !== parity2) {
      const level = getLevel(n1, c1 === 'b' ? 'blue' : 'red');
      const equivs = levels[level][c2 === 'b' ? 'blue' : 'red'];
      let convertedN1 = n1;
      for (let equiv of equivs) {
        if (Math.abs(equiv - n1) <= 1) {
          convertedN1 = equiv;
          break;
        }
      }
      return n2 < convertedN1 ? "DOWN" : "UP";
    }
    return n1 < n2 ? "UP" : "DOWN";
  };

  if (lastFiveNumbers.length < 5) return "Analyzing...";

  // Check if the pattern matches odd/even-even or even/odd-odd
  const parities = lastFiveNumbers.map(pair => {
    const num = parseInt(pair[0]);
    return isEven(num) ? 'even' : 'odd';
  });
  const isOddEvenEven = parities[0] === 'odd' && parities[1] === 'even' && parities.slice(2).every(p => p === 'even');
  const isEvenOddOdd = parities[0] === 'even' && parities[1] === 'odd' && parities.slice(2).every(p => p === 'odd');
  if (!isOddEvenEven && !isEvenOddOdd) {
    console.log("Parity pattern mismatch:", parities.join(','));
    return "Analyzing...";
  }
  console.log("Parity pattern matched:", parities.join(','));

  const levelsSequence = lastFiveNumbers.map(pair => {
    const [num, color] = pair.split('');
    return getLevel(num, color === 'b' ? 'blue' : 'red');
  });
  const levelIndices = levelsSequence.map(level => "ABCDEFG".indexOf(level));
  const parity = lastFiveNumbers.map(pair => parseInt(pair[0]) % 2 === 0 ? 'even' : 'odd');
  const colors = lastFiveNumbers.map(pair => pair[1]);

  if (parity[0] === parity[1] || Math.abs(levelIndices[0] - levelIndices[1]) !== 1) return "Analyzing...";

  let convertedPairs = [];
  for (let i = 0; i < 4; i++) convertedPairs.push(convertToDifferenceOfOne([lastFiveNumbers[i], lastFiveNumbers[i + 1]]));
  const trends = convertedPairs.map(getPairTrend);
  const upCount = trends.filter(t => t === "UP").length;
  const downCount = trends.filter(t => t === "DOWN").length;

  const levelDiff = Math.abs(levelIndices[4] - levelIndices[0]);
  if (upCount > downCount && upCount >= 2 && levelDiff >= 3) return "UP";
  if (downCount > upCount && downCount >= 2 && levelDiff >= 3) return "DOWN";
  return "Analyzing...";
}

// Signal generation with trade recording
function getSignal() {
  if (digit.length < 5) {
    console.log("Digit length < 5:", digit.length);
    return;
  }
  const lastFive = digit.slice(-5).map((d, i) =>
    spot[spot.length - 5 + i] > spot[spot.length - 6 + i] ? `${d}b` : `${d}r`
  );
  console.log("Last five numbers:", lastFive);
  const signal = document.getElementById("signal");
  const trend = analyzeTrend(lastFive);
  const now = Date.now();
  const sequenceDisplay = document.getElementById("sequence-display");
  
  console.log("Trend calculated:", trend);
  if (trend !== "Analyzing..." && now - lastAlertTime >= 10000) { // 10-second delay
    signal.innerHTML = trend;
    signal.classList.remove("blueb", "redb");
    if (trend === "UP") {
      signal.classList.add("blueb");
      if (autoTrade) {
        placeTrade("CALL");
        recordTrade(lastFive.join(','), "CALL");
      }
      if (soundEnabled) {
        const upSound = document.getElementById("upSound");
        upSound.play().catch(error => console.error("UP sound play failed:", error));
      }
    } else if (trend === "DOWN") {
      signal.classList.add("redb");
      if (autoTrade) {
        placeTrade("PUT");
        recordTrade(lastFive.join(','), "PUT");
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
    }, 10000);
  } else {
    signal.innerHTML = "Analyzing...";
    signal.classList.remove("blueb", "redb");
    console.log("No signal, trend:", trend, "lastAlertTime:", new Date(lastAlertTime), "now:", new Date(now));
  }
}

// Record a trade and check outcome after 14 seconds
function recordTrade(sequence, direction) {
  const trade = {
    sequence: sequence,
    direction: direction,
    outcome: "Pending",
    timestamp: Date.now()
  };
  tradeHistory.push(trade);
  console.log("Trade recorded:", trade);

  setTimeout(() => {
    const tradeIndex = tradeHistory.length - 1;
    if (tradeIndex >= 0 && tradeHistory[tradeIndex].outcome === "Pending") {
      const tradeTickIndex = spot.length - 1 - 7;
      if (tradeTickIndex >= 0 && spot.length > tradeTickIndex) {
        const expectedUp = spot[tradeTickIndex] < spot[spot.length - 1];
        const outcome = (trade.direction === "CALL" && expectedUp) || (trade.direction === "PUT" && !expectedUp) ? "Win" : "Loss";
        tradeHistory[tradeIndex].outcome = outcome;
        if (outcome === "Win") wins++; else losses++;
        updateCounters();
        console.log("Trade outcome:", outcome, "History:", tradeHistory[tradeIndex]);
      } else {
        console.warn("Not enough tick data to determine outcome:", tradeTickIndex, spot.length);
      }
    }
  }, 14000);
}

// Update win/loss counters in UI
function updateCounters() {
  const winsElement = document.getElementById("wins");
  const lossesElement = document.getElementById("losses");
  if (winsElement && lossesElement) {
    winsElement.textContent = wins;
    lossesElement.textContent = losses;
  } else {
    console.error("Wins or Losses elements not found in DOM");
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
    spot.push(Number(data.tick.ask).toFixed(quantity));
    digit.push(spot[spot.length - 1].slice(-1));
    time.push(data.tick.epoch);
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
}

// Reset grid colors to initial state
function resetGridColors() {
  document.querySelectorAll("table td:not(.level-label)").forEach(cell => {
    ["blue", "red", "toggle-blue", "toggle-red"].forEach(cls => cell.classList.remove(cls));
    cell.classList.add(cell.id.includes("blue") ? "blue" : "red");
  });
}

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
}

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
}

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
}

// Event listeners for user interactions
document.getElementById("call-button").addEventListener("click", () => placeTrade("CALL"));
document.getElementById("put-button").addEventListener("click", () => placeTrade("PUT"));
document.getElementById("update-trading-params").addEventListener("click", () => {
  stake = parseFloat(document.getElementById("stake").value) || 2;
  targetProfit = parseFloat(document.getElementById("target-profit").value) || 10000;
  stopLoss = parseFloat(document.getElementById("stop-loss").value) || 1000;
});
document.getElementById("trade-type-select").addEventListener("change", e => tradeType = e.target.value);
document.getElementById("api-token-button").addEventListener("click", () => {
  apiToken = document.getElementById("api-token-input").value.trim();
  if (apiToken) {
    connection.close();
    connection = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
    api = new DerivAPIBasic({ connection });
    connection.addEventListener("open", async () => {
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
});
document.getElementById("download-csv").addEventListener("click", downloadCSV);

// Update custom clock every second
setInterval(() => {
  const customClock = document.getElementById("custom-clock");
  if (customClock) {
    customClock.textContent = new Date().toUTCString(); // Display custom clock
    customClock.style.color = "#333333"; // Match your theme
    customClock.style.backgroundColor = "transparent"; // No red crap
    customClock.style.border = "none"; // No borders
    customClock.style.padding = "5px"; // Consistent padding
    customClock.style.fontWeight = "bold"; // Make the clock bold
  } else {
    console.error("Custom clock element not found!");
  }
}, 1000);

// Start API subscription
connection.addEventListener("open", () => tickSubscriber());
connection.addEventListener("message", ticksResponse);
