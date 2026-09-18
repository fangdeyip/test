/**
 * render.js —— 五种视图渲染引擎
 *
 * 视图：
 *   1. 表达式显示（规范化显示 + 化简结果 + 素蕴含标签）
 *   2. 真值表（可点击切换当前行）
 *   3. 波形图（Canvas 时序图）
 *   4. 卡诺图（DOM 表格 + 悬停高亮）
 *   5. 逻辑电路图（SVG 逻辑门）
 *
 * 联动：任一视图状态变化 → 全局 currentMask 更新 → 所有视图重绘
 */

// ================================================================
//  全局状态
// ================================================================
const State = {
  expr: "",
  vars: [],
  rows: [],
  kmapGroups: [],
  simplifiedExpr: "",
  currentMask: 0,
  error: null,
};

// ================================================================
//  预设函数
// ================================================================
const PRESETS = [
  { label: "A·B（与）",          expr: "A&B" },
  { label: "A+B（或）",           expr: "A|B" },
  { label: "A⊕B（异或）",        expr: "A^B" },
  { label: "(AB)'（与非）",       expr: "(A&B)'" },
  { label: "A'（非）",            expr: "A'" },
  { label: "半加器 Sum",          expr: "A^B" },
  { label: "半加器 Carry",        expr: "A&B" },
  { label: "全加器 Sum",          expr: "(A^B)^C" },
  { label: "全加器 Carry",        expr: "A&B|B&C|A&C" },
  { label: "3-8译码器 Y0",        expr: "A'B'C'" },
  { label: "3-8译码器 Y7",        expr: "ABC" },
  { label: "多数表决器(3入)",      expr: "AB+BC+AC" },
  { label: "A'B+AB'（异或等价）", expr: "A'B+AB'" },
];

// ================================================================
//  入口：解析表达式，更新全部视图
// ================================================================
function update(expr) {
  State.expr = expr;
  State.error = null;

  if (!expr.trim()) { clearAll(); return; }

  try {
    const result = LogicEngine.simplifyKM(expr);
    State.vars = result.vars;
    State.rows = result.rows;
    State.kmapGroups = result.kmapGroups || [];
    State.simplifiedExpr = result.simplifiedExpr || "";
  } catch (e) {
    State.error = e.message;
    clearAll();
    showError(e.message);
    return;
  }

  State.currentMask = 0;
  hideError();
  renderAll();
}

// ================================================================
//  清空所有视图
// ================================================================
function clearAll() {
  document.getElementById("exprDisplay").textContent = "—";
  document.getElementById("simplifiedDisplay").textContent = "";
  document.getElementById("simplifiedDisplay").style.display = "none";
  document.getElementById("primeImplicantsList").innerHTML = "";
  document.getElementById("truthTableHead").innerHTML = "";
  document.getElementById("truthTableBody").innerHTML = "";
  document.getElementById("kmapHead").innerHTML = "";
  document.getElementById("kmapBody").innerHTML = "";
  document.getElementById("circuitSvg").innerHTML = "";
  clearWaveform();
}

// ================================================================
//  渲染全部视图
// ================================================================
function renderAll() {
  renderExprDisplay();
  renderTruthTable();
  renderWaveform();
  renderKmap();
  renderCircuit();
}

// ================================================================
//  视图 1：表达式显示
// ================================================================
function renderExprDisplay() {
  const disp = document.getElementById("exprDisplay");
  const simp = document.getElementById("simplifiedDisplay");
  const piList = document.getElementById("primeImplicantsList");

  disp.textContent = LogicEngine.normalizeExpr(State.expr);

  if (State.simplifiedExpr) {
    simp.textContent = State.simplifiedExpr;
    simp.style.display = "block";
  } else {
    simp.style.display = "none";
  }

  // 素蕴含标签
  piList.innerHTML = "";
  if (State.kmapGroups.length > 0) {
    const label = document.createElement("span");
    label.style.cssText = "font-size:.75rem;color:var(--ink-faint);font-style:italic;margin-right:.3rem;";
    label.textContent = "素蕴含：";
    piList.appendChild(label);
    State.kmapGroups.forEach((pi, idx) => {
      const tag = document.createElement("span");
      tag.className = "pi-tag";
      tag.textContent = pi.label;
      tag.title = "覆盖: " + (pi.cover || []).map(c => `m${c}`).join(", ");
      tag.addEventListener("mouseenter", () => highlightGroup(idx));
      tag.addEventListener("mouseleave", () => clearHighlight());
      piList.appendChild(tag);
    });
  }
}

// ================================================================
//  视图 2：真值表
// ================================================================
function renderTruthTable() {
  const thead = document.getElementById("truthTableHead");
  const tbody = document.getElementById("truthTableBody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  const vars = State.vars;
  const rows = State.rows;

  // 表头
  vars.forEach(v => {
    const th = document.createElement("th");
    th.textContent = v;
    thead.appendChild(th);
  });
  const outTh = document.createElement("th");
  outTh.textContent = "F";
  outTh.className = "out-col";
  thead.appendChild(outTh);

  // 数据行
  rows.forEach(row => {
    const tr = document.createElement("tr");
    if (row.mask === State.currentMask) tr.classList.add("current-row");

    vars.forEach(v => {
      const td = document.createElement("td");
      td.textContent = row.binding[v];
      td.dataset.mask = row.mask;
      tr.appendChild(td);
    });

    const outTd = document.createElement("td");
    outTd.textContent = row.out;
    outTd.className = "out-col";
    outTd.dataset.mask = row.mask;
    tr.appendChild(outTd);

    tr.addEventListener("click", () => setCurrentMask(row.mask));
    tbody.appendChild(tr);
  });
}

// ================================================================
//  设置当前行，同步联动
// ================================================================
function setCurrentMask(mask) {
  State.currentMask = mask;

  document.querySelectorAll("#truthTableBody tr").forEach(tr => {
    const m = parseInt(tr.querySelector("td").dataset.mask);
    tr.classList.toggle("current-row", m === mask);
  });

  document.querySelectorAll(".kmap-panel td.cell-data").forEach(td => {
    const isHl = parseInt(td.dataset.mask) === mask;
    td.classList.toggle("cell-hl", isHl);
  });

  drawWaveform();
}

// ================================================================
//  视图 3：波形图（Canvas）
// ================================================================
function clearWaveform() {
  const canvas = document.getElementById("waveCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.height = "90px";
}

function drawWaveform() {
  const canvas = document.getElementById("waveCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;  // jsdom 无 canvas 时的兜底

  const parent = canvas.parentElement;
  const W = parent.clientWidth || 680;
  canvas.width = W;

  ctx.clearRect(0, 0, W, canvas.height);

  const vars = State.vars;
  const rows = State.rows;
  const n = vars.length;
  if (n === 0 || rows.length === 0) return;

  const CH_COLORS = ["#1a5276", "#c0392b", "#196f3d", "#7d6608"];
  const waveH  = 16;
  const gap    = 10;
  const labelW = 36;
  const headerH = 18;
  const outH   = 18;
  const totalH  = headerH + n * (waveH + gap) + outH + gap;
  canvas.height = Math.max(totalH + 10, 90);

  const leftMargin = labelW;
  const steps = rows.length;
  const colW = (W - leftMargin) / steps;
  const usableW = steps * colW;

  // 背景网格
  ctx.strokeStyle = "#ddd5c0";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= steps; i++) {
    const x = leftMargin + i * colW;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let ch = 0; ch <= n + 1; ch++) {
    const y = headerH + ch * (waveH + gap);
    ctx.beginPath(); ctx.moveTo(leftMargin, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // 通道标签
  ctx.font = "bold 10px Courier New";
  const allVars = [...vars, "F"];
  allVars.forEach((v, ch) => {
    const y = headerH + ch * (waveH + gap) + waveH * 0.65;
    ctx.fillStyle = CH_COLORS[ch % CH_COLORS.length];
    ctx.fillText(v, 2, y);
  });

  // 绘制一条波形
  function drawWave(vals, ch, color) {
    const yTop = headerH + ch * (waveH + gap);
    const yHigh = yTop + 3;
    const yLow  = yTop + waveH - 3;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    ctx.moveTo(leftMargin, vals[0] ? yHigh : yLow);

    for (let i = 0; i < steps; i++) {
      const x = leftMargin + i * colW;
      const nextX = leftMargin + (i + 1) * colW;
      const y = vals[i] ? yHigh : yLow;

      if (i > 0 && vals[i] !== vals[i - 1]) {
        ctx.lineTo(x, vals[i - 1] ? yHigh : yLow);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(nextX, y);
    }
    ctx.stroke();

    // 描点
    ctx.fillStyle = color;
    for (let i = 0; i < steps; i++) {
      const px = leftMargin + i * colW + colW * 0.5;
      const py = vals[i] ? yHigh : yLow;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 当前步高亮竖条
    const curX = leftMargin + State.currentMask * colW;
    ctx.fillStyle = "rgba(255, 200, 50, 0.2)";
    ctx.fillRect(curX, yTop, colW, waveH);

    // 0/1 标注
    ctx.fillStyle = "#555";
    ctx.font = "9px Courier New";
    for (let i = 0; i < steps; i++) {
      const px = leftMargin + i * colW + 2;
      const py = vals[i] ? yHigh - 2 : yLow + 11;
      ctx.fillText(vals[i], px, py);
    }
  }

  // 变量波形
  vars.forEach((v, ch) => {
    drawWave(rows.map(r => r.binding[v]), ch, CH_COLORS[ch % CH_COLORS.length]);
  });

  // 输出波形
  drawWave(rows.map(r => r.out), n, "#c0392b");
}

function renderWaveform() {
  requestAnimationFrame(() => drawWaveform());
}

// ================================================================
//  视图 4：卡诺图
// ================================================================

// Gray 码表
const GRAY2 = [0, 1];
const GRAY4 = [0, 1, 3, 2]; // 4列

function getKmapLayout(n) {
  if (n === 2) return { rows: 2, cols: 2, rowLabels: ["0", "1"], colLabels: ["0", "1"] };
  if (n === 3) return { rows: 2, cols: 4, rowLabels: ["0", "1"], colLabels: ["00", "01", "11", "10"] };
  if (n === 4) return { rows: 4, cols: 4, rowLabels: ["00", "01", "11", "10"], colLabels: ["00", "01", "11", "10"] };
  return { rows: 2, cols: 2, rowLabels: ["0", "1"], colLabels: ["0", "1"] };
}

// mask 转换为 Gray 码行列索引
function maskToRC(mask, n, layout) {
  if (n === 2) {
    // A=r(行), B=c(列)  mask = (A<<1)|B
    return { r: (mask >> 1) & 1, c: mask & 1 };
  }
  if (n === 3) {
    // A=r(行), BC=c(列)  mask = (A<<2)|(B<<1)|C
    const r = (mask >> 2) & 1;
    const bc = mask & 3;
    const c = GRAY4.indexOf(bc);
    return { r, c: c >= 0 ? c : 0 };
  }
  if (n === 4) {
    // AB=r(行), CD=c(列)  mask = (AB<<2)|CD, AB=rGray, CD=cGray
    const abGray = (mask >> 2) & 3;
    const cdGray = mask & 3;
    const r = GRAY4.indexOf(abGray);
    const c = GRAY4.indexOf(cdGray);
    return { r: r >= 0 ? r : 0, c: c >= 0 ? c : 0 };
  }
  return { r: 0, c: 0 };
}

function renderKmap() {
  const n = State.vars.length;
  if (n === 0) return;

  const layout = getKmapLayout(n);
  const thead = document.getElementById("kmapHead");
  const tbody = document.getElementById("kmapBody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  // 左上角角头
  const corner = document.createElement("th");
  corner.className = "corner";
  corner.textContent = n === 2 ? "AB" : n === 3 ? "BC\\A" : "CD\\AB";
  thead.appendChild(corner);

  // 列头
  layout.colLabels.forEach(label => {
    const th = document.createElement("th");
    th.textContent = label;
    thead.appendChild(th);
  });

  // 行和格子
  layout.rowLabels.forEach((rowLabel, ri) => {
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.textContent = rowLabel;
    tr.appendChild(th);

    for (let ci = 0; ci < layout.cols; ci++) {
      // 通过 Gray 码反算 mask
      const { rGrayArr, cGrayArr } = (() => {
        if (n === 2) return { rGrayArr: GRAY2, cGrayArr: GRAY2 };
        if (n === 3) return { rGrayArr: GRAY2, cGrayArr: GRAY4 };
        if (n === 4) return { rGrayArr: GRAY4, cGrayArr: GRAY4 };
        return { rGrayArr: GRAY2, cGrayArr: GRAY2 };
      })();

      let mask;
      if (n === 2) {
        mask = (rGrayArr[ri] << 1) | cGrayArr[ci];
      } else if (n === 3) {
        mask = (rGrayArr[ri] << 2) | cGrayArr[ci];
      } else {
        mask = (rGrayArr[ri] << 2) | cGrayArr[ci];
      }

      const td = document.createElement("td");
      td.className = "cell-data";
      td.dataset.mask = mask;

      const row = State.rows.find(r => r.mask === mask);
      const out = row ? row.out : 0;
      td.textContent = out;
      td.classList.add(out === 1 ? "cell-1" : "cell-0");
      if (mask === State.currentMask) td.classList.add("cell-hl");

      td.addEventListener("mouseenter", () => {
        setCurrentMask(mask);
      });

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });
}

// ================================================================
//  素蕴含高亮（悬停标签时）
// ================================================================
function highlightGroup(idx) {
  document.querySelectorAll(".kmap-panel td.cell-data").forEach(td => {
    td.classList.remove("cell-hl");
  });

  if (State.kmapGroups[idx]) {
    const pi = State.kmapGroups[idx];
    pi.cover.forEach(m => {
      const td = document.querySelector(`.kmap-panel td.cell-data[data-mask="${m}"]`);
      if (td) td.classList.add("cell-hl");
    });
  }
}

function clearHighlight() {
  highlightKmapCell(State.currentMask);
}

function highlightKmapCell(mask) {
  document.querySelectorAll(".kmap-panel td.cell-data").forEach(td => {
    const m = parseInt(td.dataset.mask);
    td.classList.toggle("cell-hl", m === mask);
  });
}

// ================================================================
//  视图 5：逻辑电路图（SVG）
// ================================================================
function renderCircuit() {
  const svg = document.getElementById("circuitSvg");
  svg.innerHTML = "";

  if (!State.expr || State.error || State.rows.length === 0) return;

  const vars = State.vars;
  const n = vars.length;

  const W = Math.max(640, svg.parentElement.clientWidth || 640);
  const H = 180;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);

  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function textNode(str, x, y, opts = {}) {
    const t = el("text", {
      x, y,
      "text-anchor": opts.anchor || "middle",
      "font-family": "Courier New, monospace",
      "font-size": opts.size || 11,
      fill: opts.fill || "#1a1a1a",
    });
    t.textContent = str;
    return t;
  }

  // 背景网格
  const bgGrid = el("g", { class: "grid" });
  for (let x = 0; x <= W; x += 20) {
    bgGrid.appendChild(el("line", { x1: x, y1: 0, x2: x, y2: H, stroke: "#e8e0d0", "stroke-width": 0.4 }));
  }
  for (let y = 0; y <= H; y += 20) {
    bgGrid.appendChild(el("line", { x1: 0, y1: y, x2: W, y2: y, stroke: "#e8e0d0", "stroke-width": 0.4 }));
  }
  svg.appendChild(bgGrid);

  // 门宽/间距
  const GATE_W = 50;
  const GATE_H = 24;
  const LABEL_H = 20;
  const BRANCH_X = 60; // 子树宽度
  const NOT_W = 30;
  const VAR_SPACING = Math.min(28, (H - 20) / Math.max(n, 1));
  const INPUT_X = 60;
  const OUT_X = W - 80;

  // 输入变量纵坐标
  const varY = i => 20 + i * VAR_SPACING + VAR_SPACING * 0.5;
  const totalInputH = n * VAR_SPACING;
  const rootY = H / 2;

  // 变量输入标注
  vars.forEach((v, i) => {
    const y = varY(i);
    svg.appendChild(textNode(v, INPUT_X - 8, y + 4, { anchor: "end", size: 12, fill: "#1a5276" }));
    // 接点
    svg.appendChild(el("circle", { cx: INPUT_X + 20, cy: y, r: 3, stroke: "#1a5276", "stroke-width": 1.5, fill: "#1a5276" }));
    // 输入线（延伸到左侧）
    svg.appendChild(el("line", { x1: 0, y1: y, x2: INPUT_X + 20, y2: y, stroke: "#1a5276", "stroke-width": 1.5 }));
  });

  // ---- AST 布局与绘制 ----
  // 布局函数：返回 { x, y, type, left, right, child }
  function layoutAST(node, x, yTop, yBot) {
    const midY = (yTop + yBot) / 2;

    if (node.op === "VAR") {
      const vi = vars.indexOf(node.name);
      return { x, y: vi >= 0 ? varY(vi) : midY, type: "var" };
    }
    if (node.op === "CONST") {
      return { x, y: midY, type: "const", val: node.value };
    }
    if (node.op === "NOT") {
      const child = layoutAST(node.child, x - NOT_W - BRANCH_X, yTop, yBot);
      return { x, y: midY, type: "not", child };
    }
    if (node.op === "AND" || node.op === "OR" || node.op === "XOR") {
      const childX = x - GATE_W - BRANCH_X;
      const left  = layoutAST(node.left,  childX, yTop,    midY);
      const right = layoutAST(node.right, childX, midY,    yBot);
      return { x, y: midY, type: node.op.toLowerCase(), left, right };
    }
    return { x, y: midY, type: "unknown" };
  }

  // 绘制门
  function drawGate(node, x, y) {
    if (!node) return;

    if (node.type === "var") {
      const vy = node.y;
      // 从变量输入点拉线到此处
      svg.appendChild(el("line", {
        x1: INPUT_X + 20, y1: vy,
        x2: x, y2: y,
        stroke: "#1a5276", "stroke-width": 1.5,
      }));
      svg.appendChild(el("circle", { cx: x, cy: y, r: 3, stroke: "#1a5276", "stroke-width": 1.5, fill: "#1a5276" }));
      return;
    }

    if (node.type === "not") {
      drawGate(node.child, x - NOT_W - 5, y);
      svg.appendChild(el("path", {
        d: `M ${x - NOT_W},${y - 10} L ${x},${y} L ${x - NOT_W},${y + 10} Z`,
        stroke: "#1a1a1a", "stroke-width": 1.5, fill: "#f5f0e8",
      }));
      svg.appendChild(el("circle", { cx: x + 2, cy: y, r: 3.5, stroke: "#1a1a1a", "stroke-width": 1.5, fill: "#f5f0e8" }));
      svg.appendChild(el("line", { x1: x - NOT_W - 5, y1: y, x2: x - NOT_W, y2: y, stroke: "#4a4a4a", "stroke-width": 1.5 }));
      return;
    }

    if (node.type === "and") {
      const childX = x - GATE_W - BRANCH_X;
      if (node.left) {
        drawGate(node.left, childX, node.left.y);
        svg.appendChild(el("line", {
          x1: childX, y1: node.left.y,
          x2: x - GATE_W, y2: y - 5,
          stroke: "#4a4a4a", "stroke-width": 1.5,
        }));
      }
      if (node.right) {
        drawGate(node.right, childX, node.right.y);
        svg.appendChild(el("line", {
          x1: childX, y1: node.right.y,
          x2: x - GATE_W, y2: y + 5,
          stroke: "#4a4a4a", "stroke-width": 1.5,
        }));
      }
      svg.appendChild(el("path", {
        d: `M ${x - GATE_W},${y - GATE_H / 2} L ${x - GATE_W + 18},${y - GATE_H / 2} Q ${x},${y} ${x - GATE_W + 18},${y + GATE_H / 2} L ${x - GATE_W},${y + GATE_H / 2} Z`,
        stroke: "#1a1a1a", "stroke-width": 1.5, fill: "#f5f0e8",
      }));
      svg.appendChild(textNode("&", x - GATE_W + GATE_W / 2, y + 4, { size: 11, fill: "#1a1a1a" }));
      return;
    }

    if (node.type === "or") {
      const childX = x - GATE_W - BRANCH_X;
      if (node.left) {
        drawGate(node.left, childX, node.left.y);
        svg.appendChild(el("line", { x1: childX, y1: node.left.y, x2: x - GATE_W, y2: y - 5, stroke: "#4a4a4a", "stroke-width": 1.5 }));
      }
      if (node.right) {
        drawGate(node.right, childX, node.right.y);
        svg.appendChild(el("line", { x1: childX, y1: node.right.y, x2: x - GATE_W, y2: y + 5, stroke: "#4a4a4a", "stroke-width": 1.5 }));
      }
      svg.appendChild(el("path", {
        d: `M ${x - GATE_W},${y - GATE_H / 2} Q ${x - GATE_W + 8},${y} ${x - GATE_W},${y + GATE_H / 2} Q ${x - GATE_W + 20},${y + GATE_H / 2} ${x},${y} Q ${x - GATE_W + 20},${y - GATE_H / 2} ${x - GATE_W},${y - GATE_H / 2}`,
        stroke: "#1a1a1a", "stroke-width": 1.5, fill: "#f5f0e8",
      }));
      svg.appendChild(textNode("≥1", x - GATE_W + GATE_W / 2, y + 4, { size: 10, fill: "#1a1a1a" }));
      return;
    }

    if (node.type === "xor") {
      const childX = x - GATE_W - BRANCH_X - 5;
      if (node.left) {
        drawGate(node.left, childX, node.left.y);
        svg.appendChild(el("line", { x1: childX, y1: node.left.y, x2: x - GATE_W - 5, y2: y - 5, stroke: "#4a4a4a", "stroke-width": 1.5 }));
      }
      if (node.right) {
        drawGate(node.right, childX, node.right.y);
        svg.appendChild(el("line", { x1: childX, y1: node.right.y, x2: x - GATE_W - 5, y2: y + 5, stroke: "#4a4a4a", "stroke-width": 1.5 }));
      }
      // XOR 门体
      svg.appendChild(el("path", {
        d: `M ${x - GATE_W - 5},${y - GATE_H / 2} Q ${x - GATE_W + 8},${y} ${x - GATE_W - 5},${y + GATE_H / 2} Q ${x - GATE_W + 25},${y + GATE_H / 2} ${x + 5},${y} Q ${x - GATE_W + 25},${y - GATE_H / 2} ${x - GATE_W - 5},${y - GATE_H / 2}`,
        stroke: "#1a1a1a", "stroke-width": 1.5, fill: "#f5f0e8",
      }));
      // 额外弧
      svg.appendChild(el("path", {
        d: `M ${x - GATE_W - 5},${y - GATE_H / 2} Q ${x - GATE_W + 3},${y} ${x - GATE_W - 5},${y + GATE_H / 2}`,
        stroke: "#1a1a1a", "stroke-width": 1.5, fill: "none",
      }));
      svg.appendChild(textNode("=1", x - GATE_W / 2, y + 4, { size: 10, fill: "#1a1a1a" }));
      return;
    }
  }

  // 获取 AST
  let ast;
  try {
    const parsed = LogicEngine.parse(State.expr);
    ast = parsed.ast;
  } catch (e) {
    svg.appendChild(textNode("支持: & | ^ ! '", W / 2, H / 2, { size: 12, fill: "#8a8a8a" }));
    return;
  }

  // 布局
  const rootNode = layoutAST(ast, OUT_X - 50, 10, H - 10);

  // 绘制
  drawGate(rootNode, rootNode.x, rootNode.y);

  // 输出门
  const outY = rootNode.y;
  svg.appendChild(el("line", { x1: rootNode.x + 25, y1: outY, x2: OUT_X, y2: outY, stroke: "#4a4a4a", "stroke-width": 1.5 }));
  svg.appendChild(el("path", {
    d: `M ${OUT_X},${outY - 10} L ${OUT_X + 22},${outY} L ${OUT_X},${outY + 10} Z`,
    stroke: "#c0392b", "stroke-width": 1.5, fill: "#fdecea",
  }));
  svg.appendChild(textNode("F", OUT_X + 11, outY + 4, { size: 10, fill: "#c0392b" }));
  svg.appendChild(textNode("OUT", OUT_X, outY + 22, { size: 9, fill: "#c0392b" }));
}

// ================================================================
//  错误提示
// ================================================================
function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.textContent = "⚠ " + msg;
  el.classList.add("visible");
}

function hideError() {
  const el = document.getElementById("errorMsg");
  if (el) el.classList.remove("visible");
}

// ================================================================
//  resize → 重绘波形图
// ================================================================
window.addEventListener("resize", () => {
  if (State.rows.length > 0) requestAnimationFrame(() => drawWaveform());
});
