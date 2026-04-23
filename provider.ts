/// <reference path="../../typings/plugin.d.ts" />
/// <reference path="../../typings/system.d.ts" />
/// <reference path="../../typings/app.d.ts" />
/// <reference path="../../typings/core.d.ts" />
/// <reference path="./anilist-watch-order.d.ts" />

function init() {
	$ui.register(async (ctx) => {
		const CACHE_KEY = "awo.cache";
		const STORAGE_LAYOUT = "awo.layout";
		const STORAGE_NODE_COLORS = "awo.nodeColors";
		const STORAGE_FONT_COLORS = "awo.fontColors";
		const STORAGE_BORDER_WIDTHS = "awo.borderWidths";
		const STORAGE_LOCKED = "awo.locked";

		const ALLOWED_RELATIONS: $app.AL_MediaRelation[] = [
			"SEQUEL", "PREQUEL", "SPIN_OFF", "PARENT", "SIDE_STORY", "ALTERNATIVE", "SUMMARY",
		];

		const currentMediaId = ctx.state<number | null>(null);
		const isOpen = ctx.state<boolean>(false);
		const fetching = ctx.state<boolean>(false);
		const calls = ctx.state<number>(0);

		const graphData = ctx.state<{
			nodes: RelationsTreeNode[];
			edges: RelationsTreeEdge[];
			mediaId: number | null;
			ready: boolean;
		}>({ nodes: [], edges: [], mediaId: null, ready: false });

		const queued = ctx.state<number[]>([]);
		const fetched = ctx.state<number[]>([]);
		const seen = ctx.state<number[]>([]);

		const buttonStyle = {
			backgroundImage:
				"url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNOSA0djltMyAwSDZtNiAxNEg2bTAtN3MzLTMgNSAwLTUgNy01IDdtMCA3LjVzMi0zIDUtMSAwIDQuNSAwIDQuNSAzIDIuNSAwIDQuNS01LTEtNS0xbTUtMy41SDlNOSA0IDYgNm0xNSAxOGgyMk0yMSAzOGgyMk0yMSAxMGgyMiIgc3Ryb2tlPSIjY2FjYWNhIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg==)",
			backgroundRepeat: "no-repeat",
			backgroundPosition: "center",
			backgroundSize: "21.5px 21.5px",
			width: "40px",
			padding: "0",
			paddingInlineStart: "0.5rem",
		};

		const button = ctx.action.newAnimePageButton({
			label: "\u200b",
			intent: "gray-subtle",
			style: buttonStyle,
			tooltipText: "Watch Order",
		});
		button.mount();

		const webview = ctx.newWebview({
			slot: "before-anime-entry-episode-list",
			width: "100%",
			height: "500px",
			maxHeight: "65vh",
			hidden: true,
		});

		ctx.effect(() => {
			if (isOpen.get() && webview.isHidden()) webview.show();
			else if (!isOpen.get() && !webview.isHidden()) webview.hide();
		}, [isOpen]);

		webview.channel.sync("fetching", fetching);

		webview.channel.on("close", () => isOpen.set(false));

		webview.channel.on("navigate", (mediaId: number) => {
			ctx.screen.navigateTo("/entry", { id: mediaId.toString() });
		});

		webview.channel.on("persistLayout", (data) => {
			$storage.set(STORAGE_LAYOUT, data);
		});

		webview.channel.on("persistNodeColors", (data) => {
			$storage.set(STORAGE_NODE_COLORS, data);
		});

		webview.channel.on("persistFontColors", (data) => {
			$storage.set(STORAGE_FONT_COLORS, data);
		});

		webview.channel.on("persistBorderWidths", (data) => {
			$storage.set(STORAGE_BORDER_WIDTHS, data);
		});

		webview.channel.on("persistLocked", (data) => {
			$storage.set(STORAGE_LOCKED, data);
		});

		webview.channel.on("resetLayout", () => {
			$storage.set(STORAGE_LAYOUT, {});
			$storage.set(STORAGE_NODE_COLORS, {});
			$storage.set(STORAGE_FONT_COLORS, {});
			$storage.set(STORAGE_BORDER_WIDTHS, {});
		});

		webview.channel.on("ready", () => {
			const current = graphData.get();
			if (current.ready && current.nodes.length > 0) {
				webview.channel.send("visualState", buildVisualState());
				webview.channel.send("graphData", current);
			}
		});

		webview.setContent(
			() => /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
html {
	color-scheme: dark;
	overflow: hidden;
	border-radius: 15px;
	user-select: none;
	-webkit-user-select: none;
}
body {
	border-radius: 15px;
	overflow: hidden;
	color: #fff;
	font-family: -apple-system, system-ui, sans-serif;
	margin: 0;
	display: flex;
	flex-direction: column;
	height: 100vh;
	box-sizing: border-box;
	user-select: none;
	-webkit-user-select: none;
}
.header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 0.5rem 0;
	margin-bottom: 0.5rem;
	gap: 0.5rem;
}
.header h3 {
	margin: 0;
	font-size: 1.1rem;
	white-space: nowrap;
}
.close-btn {
	background: none;
	border: none;
	color: #fff;
	font-size: 1.2rem;
	cursor: pointer;
	padding: 0.25rem 0.5rem;
}
.close-btn:hover { opacity: 0.7; }
.graph-wrapper {
	flex: 1;
	position: relative;
	background: #111;
	border-radius: 15px;
	overflow: hidden;
	border: 1px solid #ffffff0f;
	cursor: default;
	user-select: none;
	-webkit-user-select: none;
}
.graph-area {
	width: 100%;
	height: 100%;
	position: relative;
	z-index: 1;
	user-select: none !important;
	-webkit-user-select: none !important;
}
.loading {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1rem;
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 5;
}
.spinner {
	width: 3rem;
	height: 3rem;
	border: 3px solid rgba(255, 255, 255, 0.1);
	border-top-color: #fff;
	border-radius: 50%;
	animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.extras {
	color: #919191;
	margin-top: 0.5rem;
	margin-bottom: 0.5rem;
	font-size: 0.85rem;
	display: flex;
	justify-content: flex-end;
	align-items: center;
}
.hint { font-size: 0.75rem; color: #666; }
#graph-lock-btn {
	position: absolute;
	top: 10px;
	left: 10px;
	z-index: 100;
	padding: 4px 12px;
	border-radius: 6px;
	border: 1px solid rgba(255,255,255,0.15);
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.15s ease;
	background: rgba(200, 50, 50, 0.9);
	color: #fff;
	text-shadow: 0 1px 2px rgba(0,0,0,0.4);
	backdrop-filter: blur(4px);
	user-select: none;
	pointer-events: auto;
}
#graph-lock-btn:hover { filter: brightness(1.15); }
#graph-lock-btn.locked { background: rgba(50, 120, 200, 0.9); }
#graph-reset-btn {
	position: absolute;
	top: 10px;
	right: 10px;
	z-index: 100;
	padding: 4px 12px;
	border-radius: 6px;
	border: 1px solid rgba(255,255,255,0.15);
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.15s ease;
	background: rgba(80, 80, 80, 0.9);
	color: #fff;
	text-shadow: 0 1px 2px rgba(0,0,0,0.4);
	backdrop-filter: blur(4px);
	user-select: none;
	pointer-events: auto;
}
#graph-reset-btn:hover { background: rgba(120, 120, 120, 0.9); }
*:focus { outline: none !important; }
::selection { background: transparent; }
canvas {
	user-select: none !important;
	-webkit-user-select: none !important;
	pointer-events: auto;
}
#selection-box {
	display: none;
	position: fixed;
	border: 2px solid #4a89dc;
	background: rgba(74, 137, 220, 0.15);
	z-index: 1000;
	pointer-events: none;
	user-select: none;
}
#confirm-backdrop {
	display: none;
	position: fixed;
	inset: 0;
	background: rgba(0,0,0,0.6);
	backdrop-filter: blur(4px);
	z-index: 2000;
	align-items: center;
	justify-content: center;
}
#confirm-backdrop.active { display: flex; }
#confirm-card {
	background: #1a1a1a;
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 12px;
	padding: 1.5rem;
	min-width: 280px;
	max-width: 90vw;
	box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
#confirm-card h4 {
	margin: 0 0 0.5rem 0;
	font-size: 1.05rem;
	font-weight: 600;
	color: #fff;
}
#confirm-card p {
	margin: 0 0 1.25rem 0;
	font-size: 0.85rem;
	color: #a0a0a0;
	line-height: 1.4;
}
.confirm-actions {
	display: flex;
	justify-content: flex-end;
	gap: 0.5rem;
}
.confirm-btn {
	padding: 6px 14px;
	border-radius: 6px;
	border: 1px solid rgba(255,255,255,0.1);
	font-size: 0.8rem;
	font-weight: 600;
	cursor: pointer;
	transition: all 0.15s ease;
	color: #fff;
	backdrop-filter: blur(4px);
}
.confirm-btn:hover { filter: brightness(1.15); }
.confirm-btn.cancel { background: rgba(80,80,80,0.8); }
.confirm-btn.danger { background: rgba(200, 50, 50, 0.9); }
#selection-badge {
	position: absolute;
	bottom: 10px;
	left: 10px;
	z-index: 100;
	background: rgba(26, 26, 26, 0.9);
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 6px;
	padding: 3px 10px;
	font-size: 0.7rem;
	color: #a0a0a0;
	font-weight: 500;
	letter-spacing: 0.02em;
	backdrop-filter: blur(4px);
	opacity: 0;
	transform: translateY(6px);
	transition: opacity 0.25s ease, transform 0.25s ease;
	pointer-events: none;
	user-select: none;
}
#selection-badge.active {
	opacity: 1;
	transform: translateY(0);
}
#color-toolbar {
	display: flex;
	position: absolute;
	bottom: 12px;
	left: 50%;
	transform: translateX(-50%) translateY(10px);
	z-index: 100;
	background: rgba(26, 26, 26, 0.95);
	border: 1px solid rgba(255,255,255,0.08);
	border-radius: 8px;
	padding: 6px 14px;
	align-items: center;
	gap: 0;
	backdrop-filter: blur(8px);
	box-shadow: 0 4px 20px rgba(0,0,0,0.4);
	user-select: none;
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.25s ease, transform 0.25s ease, pointer-events 0s 0.25s;
}
#color-toolbar.active {
	opacity: 1;
	transform: translateX(-50%) translateY(0);
	pointer-events: auto;
	transition: opacity 0.25s ease, transform 0.25s ease;
}
#color-toolbar .control-pair { display: flex; align-items: center; gap: 4px; padding: 0 8px; }
#color-toolbar .control-pair span {
	font-size: 0.65rem;
	color: #a0a0a0;
	font-weight: 500;
	text-transform: uppercase;
	letter-spacing: 0.03em;
}
#color-toolbar .divider { width: 1px; height: 14px; background: rgba(255,255,255,0.08); }
#color-toolbar input[type="color"] {
	-webkit-appearance: none;
	appearance: none;
	width: 20px;
	height: 20px;
	border: 2px solid rgba(255,255,255,0.2);
	border-radius: 50%;
	padding: 0;
	background: none;
	cursor: pointer;
	overflow: hidden;
	transition: transform 0.15s ease, border-color 0.15s ease;
}
#color-toolbar input[type="color"]:hover { transform: scale(1.15); border-color: rgba(255,255,255,0.5); }
#color-toolbar input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
#color-toolbar input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }
#color-toolbar input[type="color"]::-moz-color-swatch { border: none; border-radius: 50%; }
#color-toolbar input[type="number"].border-input {
	width: 24px;
	height: 20px;
	border: 1px solid rgba(255,255,255,0.15);
	border-radius: 4px;
	background: rgba(0,0,0,0.3);
	color: #fff;
	font-size: 0.7rem;
	text-align: center;
	padding: 0;
	-moz-appearance: textfield;
}
#color-toolbar input[type="number"].border-input::-webkit-outer-spin-button,
#color-toolbar input[type="number"].border-input::-webkit-inner-spin-button {
	-webkit-appearance: none;
	margin: 0;
}
</style>
<script src="https://unpkg.com/dagre/dist/dagre.min.js"></script>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<link rel="stylesheet" href="https://unpkg.com/vis-network/styles/vis-network.min.css">
</head>
<body>
<div class="header">
	<h3>Watch Order</h3>
	<button class="close-btn" onclick="closeWebview()">&#x2715;</button>
</div>
<div class="graph-wrapper" id="graph-wrapper">
	<button id="graph-lock-btn" class="locked">Locked</button>
	<button id="graph-reset-btn" title="Reset layout">&#x21bb;</button>
	<div class="graph-area" id="graph-area">
		<div class="loading">
			<div class="spinner"></div>
			<p>Loading relations data...</p>
		</div>
	</div>
	<div id="selection-badge">0 selected</div>
	<div id="color-toolbar">
		<div class="control-pair">
			<span>Box</span>
			<input type="color" id="node-color-picker" value="#282828">
		</div>
		<div class="divider"></div>
		<div class="control-pair">
			<span>Font</span>
			<input type="color" id="font-color-picker" value="#ffffff">
		</div>
		<div class="divider"></div>
		<div class="control-pair">
			<span>Border</span>
			<input type="number" class="border-input" id="border-width-picker" value="1" min="1" max="10" step="1">
		</div>
	</div>
</div>
<div class="extras">
	<span class="hint">Shift+click to multi-select &middot; Shift+drag to box-select</span>
</div>
<div id="selection-box"></div>

<div id="confirm-backdrop">
	<div id="confirm-card">
		<h4>Reset Layout?</h4>
		<p>This will clear all saved positions, box colors, font colors, and border widths.</p>
		<div class="confirm-actions">
			<button class="confirm-btn cancel" id="confirm-cancel">Cancel</button>
			<button class="confirm-btn danger" id="confirm-reset">Reset</button>
		</div>
	</div>
</div>

<script>
var network = null, nodes = null, edges = null;
var container = document.getElementById("graph-area");
var lastGraphData = null;
var originalPositions = {};
var initialViewState = null;

var isLocked = true;
var visualStateReady = false;
var pendingGraphData = null;
var savedLayout = {};
var savedNodeColors = {};
var savedFontColors = {};
var savedBorderWidths = {};

var isManualPanning = false;
var manualPanStart = { x: 0, y: 0 };
var manualPanLast = { x: 0, y: 0 };

var selectionBox = document.getElementById("selection-box");
var isSelecting = false, selectStart = { x: 0, y: 0 };

var confirmBackdrop = document.getElementById("confirm-backdrop");
var confirmCancel = document.getElementById("confirm-cancel");
var confirmReset = document.getElementById("confirm-reset");

var pendingNodeColor = null;
var pendingFontColor = null;
var pendingBorderWidth = null;
var colorRafPending = false;

function scheduleColorFlush() {
	if (colorRafPending) return;
	colorRafPending = true;
	requestAnimationFrame(function() {
		colorRafPending = false;
		if (pendingNodeColor !== null) {
			applyNodeColor(pendingNodeColor);
			pendingNodeColor = null;
		}
		if (pendingFontColor !== null) {
			applyFontColor(pendingFontColor);
			pendingFontColor = null;
		}
		if (pendingBorderWidth !== null) {
			applyBorderWidth(pendingBorderWidth);
			pendingBorderWidth = null;
		}
	});
}

function closeWebview() { window.webview.send("close"); }

function showResetConfirm() {
	if (confirmBackdrop) confirmBackdrop.classList.add("active");
}

function hideResetConfirm() {
	if (confirmBackdrop) confirmBackdrop.classList.remove("active");
}

function updateLockButton() {
	var btn = document.getElementById("graph-lock-btn");
	if (!btn) return;
	if (isLocked) {
		btn.classList.add("locked");
		btn.textContent = "Locked";
	} else {
		btn.classList.remove("locked");
		btn.textContent = "Unlocked";
	}
}

function setLock(locked) {
	isLocked = locked;
	if (network) {
		network.setOptions({
			interaction: {
				dragNodes: !locked,
				dragView: false,
				zoomView: true,
				selectable: !locked,
				selectConnectedEdges: false,
				hoverConnectedEdges: false,
				multiselect: !locked
			}
		});
		if (locked) network.unselectAll();
	}
	updateLockButton();
	updateSelectionUI();
}

function toggleLock() {
	isLocked = !isLocked;
	setLock(isLocked);
	window.webview.send("persistLocked", isLocked);
}

function doResetLayout() {
	savedLayout = {};
	savedNodeColors = {};
	savedFontColors = {};
	savedBorderWidths = {};
	window.webview.send("resetLayout");
	if (nodes && originalPositions && Object.keys(originalPositions).length > 0) {
		var updates = [];
		Object.keys(originalPositions).forEach(function(id) {
			updates.push({
				id: Number(id),
				x: originalPositions[id].x,
				y: originalPositions[id].y,
				color: { background: "#282828", border: undefined, highlight: { background: "#282828" } },
				font: { color: "#ffffff" },
				borderWidth: 1,
				borderWidthSelected: 2
			});
		});
		nodes.update(updates);
	}
	if (network) {
		network.unselectAll();
		if (initialViewState) {
			network.moveTo({
				position: initialViewState.position,
				scale: initialViewState.scale,
				animation: { duration: 500, easingFunction: "easeInOutQuad" }
			});
		}
	}
}

function resetLayout() { showResetConfirm(); }

function applyNodeColor(color) {
	if (isLocked || !network) return;
	var sel = network.getSelectedNodes();
	sel.forEach(function(id) {
		var existing = nodes.get(id);
		var newColor = existing.color || {};
		newColor.background = color;
		if (!newColor.highlight) newColor.highlight = {};
		newColor.highlight.background = color;
		nodes.update({ id: id, color: newColor });
		savedNodeColors[id] = color;
	});
	if (sel.length > 0) window.webview.send("persistNodeColors", savedNodeColors);
}

function applyFontColor(color) {
	if (isLocked || !network) return;
	var sel = network.getSelectedNodes();
	sel.forEach(function(id) {
		var existing = nodes.get(id);
		var newFont = existing.font || {};
		newFont.color = color;
		nodes.update({ id: id, font: newFont });
		savedFontColors[id] = color;
	});
	if (sel.length > 0) window.webview.send("persistFontColors", savedFontColors);
}

function applyBorderWidth(width) {
	if (isLocked || !network) return;
	var w = parseInt(width, 10);
	if (isNaN(w) || w < 1) w = 1;
	if (w > 10) w = 10;
	var sel = network.getSelectedNodes();
	sel.forEach(function(id) {
		nodes.update({ id: id, borderWidth: w, borderWidthSelected: w });
		savedBorderWidths[id] = w;
	});
	if (sel.length > 0) window.webview.send("persistBorderWidths", savedBorderWidths);
}

function updateSelectionUI() {
	var selNodes = network ? network.getSelectedNodes().length : 0;
	var toolbar = document.getElementById("color-toolbar");
	var badge = document.getElementById("selection-badge");
	if (badge) {
		badge.textContent = selNodes + " selected";
		badge.classList.toggle("active", selNodes > 0);
	}
	if (isLocked) {
		if (toolbar) toolbar.classList.remove("active");
		return;
	}
	if (toolbar) toolbar.classList.toggle("active", selNodes > 0);
}

function renderGraph(graphData) {
	if (!graphData || !graphData.nodes || !graphData.edges || graphData.nodes.length === 0) return;
	lastGraphData = graphData;
	originalPositions = {};
	initialViewState = null;

	var graphArea = document.getElementById("graph-area");
	graphArea.innerHTML = "";

	var g = new dagre.graphlib.Graph();
	g.setGraph({ rankdir: "LR" });
	g.setDefaultEdgeLabel(function() { return {}; });
	graphData.nodes.forEach(function(n) { g.setNode(n.id, { width: 250, height: 100 }); });
	graphData.edges.forEach(function(e) { g.setEdge(e.from, e.to); });
	dagre.layout(g);

	var nodesWithPositions = graphData.nodes.map(function(n) {
		var pos = g.node(n.id);
		originalPositions[n.id] = { x: pos.x, y: pos.y };

		var savedPos = savedLayout[n.id];
		var node = Object.assign({}, n);
		node.x = savedPos ? savedPos.x : pos.x;
		node.y = savedPos ? savedPos.y : pos.y;
		node.fixed = { x: false, y: false };

		if (savedNodeColors[n.id]) {
			if (!node.color) node.color = {};
			node.color.background = savedNodeColors[n.id];
			if (!node.color.highlight) node.color.highlight = {};
			node.color.highlight.background = savedNodeColors[n.id];
		}
		if (savedFontColors[n.id]) {
			if (!node.font) node.font = {};
			node.font.color = savedFontColors[n.id];
		}
		if (savedBorderWidths[n.id]) {
			node.borderWidth = savedBorderWidths[n.id];
			node.borderWidthSelected = savedBorderWidths[n.id];
		}
		return node;
	});

	var edgeData = graphData.edges.map(function(e) {
		return Object.assign({}, e);
	});

	nodes = new vis.DataSet(nodesWithPositions);
	edges = new vis.DataSet(edgeData);
	var data = { nodes: nodes, edges: edges };

	var options = {
		physics: false,
		interaction: {
			dragNodes: !isLocked,
			dragView: false,
			zoomView: true,
			selectable: !isLocked,
			selectConnectedEdges: false,
			hoverConnectedEdges: false,
			multiselect: !isLocked
		},
		edges: { smooth: { type: "cubicBezier", forceDirection: "horizontal", roundness: 0.4 }, selectionWidth: 3 }
	};

	network = new vis.Network(graphArea, data, options);

	if (graphData.mediaId) {
		network.selectNodes([graphData.mediaId]);
		network.once("afterDrawing", function() {
			network.focus(graphData.mediaId, { scale: 1, animation: { duration: 500, easingFunction: "easeInOutQuad" } });
		});
		var mainPos = originalPositions[graphData.mediaId];
		if (mainPos) {
			initialViewState = {
				position: { x: mainPos.x, y: mainPos.y },
				scale: 1
			};
		}
	}

	network.on("click", function(params) {
		if (params.nodes.length > 0) {
			if (params.event && params.event.srcEvent && params.event.srcEvent.shiftKey) {
				return;
			} else {
				window.webview.send("navigate", params.nodes[0]);
			}
		}
		setTimeout(updateSelectionUI, 10);
	});

	network.on("dragStart", function() {
		if (container) container.style.cursor = "grabbing";
	});

	network.on("dragEnd", function() {
		if (container) container.style.cursor = "";
		if (isLocked) return;
		var positions = network.getPositions();
		var layoutPayload = {};
		Object.keys(positions).forEach(function(id) { layoutPayload[id] = positions[id]; });
		savedLayout = layoutPayload;
		window.webview.send("persistLayout", layoutPayload);
	});

	network.on("select", updateSelectionUI);
	network.on("deselect", updateSelectionUI);

	setTimeout(setupCanvasPointerHandler, 50);
	updateSelectionUI();
	updateLockButton();
}

function setupCanvasPointerHandler() {
	if (!container || !network) return;
	var canvas = container.querySelector("canvas");
	if (!canvas) {
		setTimeout(setupCanvasPointerHandler, 100);
		return;
	}
	canvas.addEventListener("pointerdown", function(e) {
		if (e.button !== 0) return;
		var rect = canvas.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var y = e.clientY - rect.top;
		var nodeId = network.getNodeAt({ x: x, y: y });
		if (nodeId !== undefined) {
			if (isLocked) {
				e.stopImmediatePropagation();
				e.preventDefault();
				if (!e.shiftKey) {
					window.webview.send("navigate", nodeId);
				}
			} else if (e.shiftKey) {
				e.stopImmediatePropagation();
				e.preventDefault();
				var current = network.getSelectedNodes();
				var idx = current.indexOf(nodeId);
				var newSel;
				if (idx === -1) {
					newSel = current.concat([nodeId]);
				} else {
					newSel = current.slice();
					newSel.splice(idx, 1);
				}
				network.setSelection({ nodes: newSel, edges: [] });
				updateSelectionUI();
			}
			return;
		}
		if (!isLocked && e.shiftKey) {
			e.stopImmediatePropagation();
			e.preventDefault();
			isSelecting = true;
			selectStart = { x: e.clientX, y: e.clientY };
			selectionBox.style.display = "block";
			selectionBox.style.left = e.clientX + "px";
			selectionBox.style.top = e.clientY + "px";
			selectionBox.style.width = "0px";
			selectionBox.style.height = "0px";
			return;
		}
		e.stopImmediatePropagation();
		e.preventDefault();
		isManualPanning = true;
		manualPanStart = { x: e.clientX, y: e.clientY };
		manualPanLast = { x: e.clientX, y: e.clientY };
		container.style.cursor = "grabbing";
		try { canvas.setPointerCapture(e.pointerId); } catch(err) {}
	}, true);
}

document.addEventListener("pointermove", function(e) {
	if (isManualPanning && network) {
		e.preventDefault();
		var dx = e.clientX - manualPanLast.x;
		var dy = e.clientY - manualPanLast.y;
		manualPanLast = { x: e.clientX, y: e.clientY };
		var viewPos = network.getViewPosition();
		var scale = network.getScale();
		network.moveTo({ position: { x: viewPos.x - dx / scale, y: viewPos.y - dy / scale }, animation: false });
	}
	if (isSelecting) {
		var left = Math.min(selectStart.x, e.clientX);
		var top = Math.min(selectStart.y, e.clientY);
		selectionBox.style.left = left + "px";
		selectionBox.style.top = top + "px";
		selectionBox.style.width = Math.abs(e.clientX - selectStart.x) + "px";
		selectionBox.style.height = Math.abs(e.clientY - selectStart.y) + "px";
	}
});

document.addEventListener("pointerup", function(e) {
	if (e.button !== 0) return;
	if (isManualPanning) {
		var dx = Math.abs(e.clientX - manualPanStart.x);
		var dy = Math.abs(e.clientY - manualPanStart.y);
		isManualPanning = false;
		if (container) container.style.cursor = "";
		try {
			var canvas = container.querySelector("canvas");
			if (canvas) canvas.releasePointerCapture(e.pointerId);
		} catch(err) {}
		if (dx < 5 && dy < 5 && network && !isLocked) {
			network.unselectAll();
			updateSelectionUI();
		}
	}
	if (isSelecting) {
		isSelecting = false;
		selectionBox.style.display = "none";
		if (Math.abs(e.clientX - selectStart.x) >= 5 || Math.abs(e.clientY - selectStart.y) >= 5) {
			var canvas = container.querySelector("canvas");
			if (!canvas || !network) return;
			var rect = canvas.getBoundingClientRect();
			var left = Math.min(selectStart.x, e.clientX) - rect.left;
			var top = Math.min(selectStart.y, e.clientY) - rect.top;
			var right = Math.max(selectStart.x, e.clientX) - rect.left;
			var bottom = Math.max(selectStart.y, e.clientY) - rect.top;
			var selNodes = [];
			var positions = network.getPositions();
			Object.keys(positions).forEach(function(id) {
				var pos = network.canvasToDOM(positions[id]);
				if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) {
					selNodes.push(Number(id));
				}
			});
			network.setSelection({ nodes: selNodes, edges: [] });
			updateSelectionUI();
		}
	}
});

window.addEventListener("blur", function() {
	if (isManualPanning) {
		isManualPanning = false;
		if (container) container.style.cursor = "";
	}
	if (isSelecting) {
		isSelecting = false;
		selectionBox.style.display = "none";
	}
});

document.addEventListener("DOMContentLoaded", function() {
	var lockBtn = document.getElementById("graph-lock-btn");
	var resetBtn = document.getElementById("graph-reset-btn");
	var nodePicker = document.getElementById("node-color-picker");
	var fontPicker = document.getElementById("font-color-picker");
	var borderPicker = document.getElementById("border-width-picker");

	if (lockBtn) lockBtn.addEventListener("click", toggleLock);
	if (resetBtn) resetBtn.addEventListener("click", resetLayout);
	if (nodePicker) {
		nodePicker.addEventListener("input", function(e) {
			pendingNodeColor = e.target.value;
			scheduleColorFlush();
		});
	}
	if (fontPicker) {
		fontPicker.addEventListener("input", function(e) {
			pendingFontColor = e.target.value;
			scheduleColorFlush();
		});
	}
	if (borderPicker) {
		borderPicker.addEventListener("input", function(e) {
			var val = parseInt(e.target.value, 10);
			if (!isNaN(val)) {
				if (val > 10) { e.target.value = 10; val = 10; }
				if (val < 1) { e.target.value = 1; val = 1; }
			}
			pendingBorderWidth = e.target.value;
			scheduleColorFlush();
		});
	}
	if (confirmCancel) confirmCancel.addEventListener("click", hideResetConfirm);
	if (confirmReset) {
		confirmReset.addEventListener("click", function() {
			hideResetConfirm();
			doResetLayout();
		});
	}
	if (confirmBackdrop) {
		confirmBackdrop.addEventListener("click", function(e) {
			if (e.target === confirmBackdrop) hideResetConfirm();
		});
	}
});

function initWebview() {
	if (!window.webview) {
		setTimeout(initWebview, 50);
		return;
	}
	window.webview.on("graphData", function(data) {
		if (data && data.ready && data.nodes.length > 0) {
			if (lastGraphData && lastGraphData.mediaId === data.mediaId) return;
			if (visualStateReady) {
				renderGraph(data);
			} else {
				pendingGraphData = data;
			}
		}
	});
	window.webview.on("visualState", function(data) {
		if (data.layout) savedLayout = data.layout;
		if (data.nodeColors) savedNodeColors = data.nodeColors;
		if (data.fontColors) savedFontColors = data.fontColors;
		if (data.borderWidths) savedBorderWidths = data.borderWidths;
		if (typeof data.locked === "boolean") setLock(data.locked);
		visualStateReady = true;
		if (pendingGraphData) {
			renderGraph(pendingGraphData);
			pendingGraphData = null;
		}
	});
	window.webview.send("ready");
}

initWebview();
</script>
</body>
</html>`,
		);

		function delay(ms: number): Promise<void> {
			return new Promise((resolve) => ctx.setTimeout(resolve, ms));
		}

		function normalizeString(type: string): string {
			return type.split("_").join(" ");
		}

		function wrapString(text: string, maxCharsPerLine?: number): string {
			if (!text) return "";
			if (!maxCharsPerLine) maxCharsPerLine = 20;
			const words = text.split(" ");
			const lines: string[] = [];
			let currentLine = "";
			words.forEach((word) => {
				if ((currentLine + word).length > maxCharsPerLine) {
					lines.push(currentLine.trim());
					currentLine = word + " ";
				} else {
					currentLine += word + " ";
				}
			});
			if (currentLine.trim().length > 0) lines.push(currentLine.trim());
			return lines.join("\n");
		}

		async function fetchMediaBulk(ids: number[]): Promise<MediaQueryResponse[]> {
			const QUERY = `query ($ids: [Int]) {
  Page {
    media(id_in: $ids, type: ANIME) {
      id
      title { userPreferred }
      startDate { year }
      type format status
      relations {
        edges {
          relationType
          node {
            id
            title { userPreferred }
            startDate { year }
            type format status
            relations {
              edges {
                relationType
                node {
                  id
                  title { userPreferred }
                  startDate { year }
                  type format status
                }
              }
            }
          }
        }
      }
    }
  }
}`;
			const res = await ctx.fetch("https://graphql.anilist.co", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: QUERY, variables: { ids } }),
			});
			if (!res.ok) throw new Error(res.statusText);
			return (await res.json()).data.Page.media;
		}

		function addNode(media: MediaQueryResponse | $app.AL_BaseAnime) {
			if (fetched.get().includes(media.id)) return false;
			fetched.set([...fetched.get(), media.id]);
			const STATUS_BORDER_COLORS: Record<$app.AL_MediaStatus, string> = {
				FINISHED: "#4a89dc",
				RELEASING: "#a0d468",
				NOT_YET_RELEASED: "#ffce54",
				CANCELLED: "#ed5565",
				HIATUS: "#ac92ec",
			};
			const statusColor = media.status ? STATUS_BORDER_COLORS[media.status] : "#4a89dc";
			const node = {
				id: media.id,
				label:
					wrapString(media.title?.userPreferred ?? "") +
					"\n\n" +
					(media.format ? normalizeString(media.format) + " " : "") +
					"(" +
					(media.startDate?.year ?? "UPCOMING") +
					")",
				shape: "box",
				borderWidth: 1,
				borderWidthSelected: 2,
				margin: 10,
				font: {
					multi: true,
					color: "#fff",
					size: 14,
					face: "Arial",
					strokeWidth: 2,
					strokeColor: "#000",
				},
				shadow: {
					enabled: true,
					color: "rgba(0,0,0,0.4)",
					size: 8,
					x: 2,
					y: 2,
				},
				color: {
					background: "#282828",
					border: statusColor,
					highlight: {
						background: "#333",
						border: "#ff00ff",
					},
					hover: {
						background: "#444",
						border: statusColor,
					},
				},
			};
			const current = graphData.get();
			graphData.set({ ...current, nodes: [...current.nodes, node], ready: false });
			return true;
		}

		function addEdgeNormalized(fromId: number, toId: number, relationType: string) {
			let edge: any;
			if (relationType === "PREQUEL")
				edge = { from: toId, to: fromId, label: normalizeString("SEQUEL"), arrows: "to" };
			else edge = { from: fromId, to: toId, label: normalizeString(relationType), arrows: "to" };
			if (relationType === "PARENT") return;
			edge.dashes = true;
			edge.color = { color: "#3d3d3d" };
			edge.font = { color: "#848484", background: "#111111", strokeWidth: 0 };
			let edgeId: string;
			if (edge.label.trim() === "ALTERNATIVE") {
				const minId = Math.min(edge.from, edge.to);
				const maxId = Math.max(edge.from, edge.to);
				edgeId = "alt-" + minId + "-" + maxId;
			} else {
				edgeId = edge.from + "-" + edge.to + "-" + edge.label;
			}
			edge.id = edgeId;
			const current = graphData.get();
			if (!current.edges.some((e: any) => e.id === edgeId))
				graphData.set({ ...current, edges: [...current.edges, edge], ready: false });
		}

		function getRelations(edges?: MediaEdge[], parentId?: number) {
			if (!edges || edges.length === 0) return;
			for (const edge of edges) {
				const { relationType, node } = edge ?? {};
				if (!node || node.type !== "ANIME") continue;
				if (relationType && ALLOWED_RELATIONS.includes(relationType)) {
					addNode(node);
					if (parentId && relationType) addEdgeNormalized(parentId, node.id, relationType);
					if (node.relations?.edges?.length) getRelations(node.relations.edges, node.id);
					else if (!seen.get().includes(node.id)) {
						seen.set([...seen.get(), node.id]);
						queued.set(Array.from(new Set([...queued.get(), node.id])));
					}
				}
			}
		}

		function buildVisualState() {
			return {
				layout: $storage.get<Record<number, { x: number; y: number }>>(STORAGE_LAYOUT) || {},
				nodeColors: $storage.get<Record<number, string>>(STORAGE_NODE_COLORS) || {},
				fontColors: $storage.get<Record<number, string>>(STORAGE_FONT_COLORS) || {},
				borderWidths: $storage.get<Record<number, number>>(STORAGE_BORDER_WIDTHS) || {},
				locked: $storage.get<boolean>(STORAGE_LOCKED) ?? true,
			};
		}

		async function walkRelations(media: $app.AL_BaseAnime) {
			if (fetching.get()) return;
			fetching.set(true);
			graphData.set({ nodes: [], edges: [], mediaId: media.id, ready: false });

			const cache = $storage.get<RelationsCache[]>(CACHE_KEY) || [];
			const cacheEntry = cache.find((e) => e.family.includes(media.id));

			if (cacheEntry) {
				webview.channel.send("visualState", buildVisualState());
				graphData.set({
					nodes: cacheEntry.nodes,
					edges: cacheEntry.edges,
					mediaId: media.id,
					ready: true,
				});
				webview.channel.send("graphData", graphData.get());
				fetching.set(false);
				return;
			}

			$store.set("now", Date.now());
			queued.set([media.id]);
			seen.set([]);
			fetched.set([]);
			addNode(media);

			do {
				const list = await fetchMediaBulk(queued.get()).catch((e: Error) => e.message);
				calls.set(calls.get() + 1);
				await delay(500);
				if (typeof list === "string") {
					ctx.toast.error("Error: " + list);
					fetching.set(false);
					return;
				}
				queued.set([]);
				for (const media of list ?? []) {
					addNode(media);
					if (media.relations?.edges?.length) getRelations(media.relations.edges, media.id);
					else if (!seen.get().includes(media.id)) {
						seen.set([...seen.get(), media.id]);
						queued.set(Array.from(new Set([...queued.get(), media.id])));
					}
				}
			} while (queued.get().length > 0);

			const finalData = graphData.get();
			$storage.set(CACHE_KEY, [
				...cache,
				{ family: fetched.get(), edges: finalData.edges, nodes: finalData.nodes },
			]);

			webview.channel.send("visualState", buildVisualState());
			graphData.set({
				...finalData,
				mediaId: currentMediaId.get(),
				ready: true,
			});
			webview.channel.send("graphData", graphData.get());

			calls.set(0);
			fetching.set(false);
		}

		async function handleButtonPress(e: { media: $app.AL_BaseAnime }) {
			currentMediaId.set(e.media.id);
			isOpen.set(true);
			await walkRelations(e.media);
		}

		ctx.effect(() => {
			button.setLoading(fetching.get());
			button.setTooltipText(fetching.get() ? "Fetching..." : "Watch Order");
			button.setStyle({
				...buttonStyle,
				...(fetching.get() ? { backgroundImage: "", textIndent: "" } : {}),
			});
		}, [fetching]);

		ctx.screen.onNavigate(async (e) => {
			if (e.pathname === "/entry" && e.searchParams?.id) {
				const newMediaId = parseInt(e.searchParams.id) || null;
				if (newMediaId && newMediaId !== currentMediaId.get()) {
					currentMediaId.set(newMediaId);
					if (isOpen.get()) {
						const entry = await ctx.anime.getAnimeEntry(newMediaId);
						if (entry?.media) await walkRelations(entry.media);
					}
				}
			} else {
				isOpen.set(false);
				currentMediaId.set(null);
			}
		});

		button.onClick(handleButtonPress);
		ctx.screen.loadCurrent();
	});
}

interface QueryResponse {
	data: { Media: MediaQueryResponse };
}
interface MediaNode {
	id: number;
	title: { userPreferred: string };
	startDate?: { year?: number } | null;
	type?: $app.AL_MediaType | null;
	format?: $app.AL_MediaFormat | null;
	status?: $app.AL_MediaStatus | null;
	relations?: MediaRelations;
}
interface MediaEdge {
	relationType?: $app.AL_MediaRelation;
	node: MediaNode;
}
interface MediaRelations {
	edges?: MediaEdge[] | null;
}
interface MediaQueryResponse extends MediaNode {}
interface RelationsTreeNode {
	id: number;
	label: string;
	shape: string;
	color: { background: string; border: string };
}
interface RelationsTreeEdge {
	from: number;
	to?: number;
	label: string;
	arrows: string;
}
interface RelationsCache {
	family: number[];
	nodes: RelationsTreeNode[];
	edges: RelationsTreeEdge[];
}
