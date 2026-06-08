(function () {
  "use strict";

  const STORAGE_KEY = "arend-categorieenboom-v1";
  const NODE_WIDTH = 154;
  const NODE_HEIGHT = 58;
  const H_GAP = 78;
  const V_GAP = 120;
  const PADDING_X = 110;
  const PADDING_TOP = 88;
  const PADDING_BOTTOM = 110;
  const ROOT_HUES = [212, 142, 275, 24, 336, 184, 45, 250, 7, 103];

  const workspace = document.querySelector("#workspace");
  const treeLayer = document.querySelector("#tree");
  const connections = document.querySelector("#connections");
  const loadExampleButton = document.querySelector("#load-example");
  const exportButton = document.querySelector("#export-json");
  const totalCount = document.querySelector("#total-count");
  const largestCount = document.querySelector("#largest-count");
  const confirmOverlay = document.querySelector("#confirm-overlay");
  const confirmMessage = document.querySelector("#confirm-message");
  const cancelDeleteButton = document.querySelector("#cancel-delete");
  const confirmDeleteButton = document.querySelector("#confirm-delete");

  let state = loadState();
  let editing = null;
  let selectedEdge = null;
  let pendingDeleteId = null;
  let panState = null;
  let suppressClickAfterPan = false;
  let edgeHoverTimer = null;
  let layout = {
    nodes: new Map(),
    edges: [],
    width: 900,
    height: 520
  };

  render();

  workspace.addEventListener("pointerdown", startPanning);
  workspace.addEventListener("pointermove", movePanning);
  workspace.addEventListener("pointerup", stopPanning);
  workspace.addEventListener("pointercancel", stopPanning);
  workspace.addEventListener("click", (event) => {
    if (!suppressClickAfterPan) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressClickAfterPan = false;
  }, true);

  treeLayer.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-action='add-child']");
    const addRootButton = event.target.closest("[data-action='add-root']");
    const insertEdgeButton = event.target.closest("[data-action='insert-edge']");
    const deleteButton = event.target.closest("[data-action='delete']");

    if (insertEdgeButton) {
      event.stopPropagation();
      insertBetween(
        insertEdgeButton.dataset.parentId,
        insertEdgeButton.dataset.childId
      );
      return;
    }

    if (addRootButton) {
      event.stopPropagation();
      addRoot();
      return;
    }

    if (addButton) {
      event.stopPropagation();
      addChild(addButton.dataset.id);
      return;
    }

    if (deleteButton) {
      event.stopPropagation();
      deleteNode(deleteButton.dataset.id);
    }
  });

  treeLayer.addEventListener("dblclick", (event) => {
    const nodeElement = event.target.closest(".node");
    if (!nodeElement) {
      return;
    }

    event.preventDefault();
    editing = { id: nodeElement.dataset.id, isNew: false };
    selectedEdge = null;
    render();
  });

  connections.addEventListener("pointerover", (event) => {
    const edge = event.target.closest(".edge-hit");
    if (!edge) {
      return;
    }

    showEdgePlus(edge.dataset.parentId, edge.dataset.childId);
  });

  connections.addEventListener("pointerout", (event) => {
    if (!event.target.closest(".edge-hit")) {
      return;
    }

    scheduleEdgePlusHide();
  });

  loadExampleButton.addEventListener("click", async () => {
    if (state.roots.length > 0) {
      const confirmed = window.confirm("Dit vervangt je huidige boom. Weet je het zeker?");
      if (!confirmed) {
        return;
      }
    }

    try {
      const response = await fetch("voorbeeld.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Voorbeeldbestand kon niet worden geladen.");
      }

      const example = await response.json();
      state = normalizeState(example);
      editing = null;
      selectedEdge = null;
      saveState();
      render();
    } catch (error) {
      window.alert("Het voorbeeld kon niet worden geladen. Start de app via een lokale webserver of publiceer de bestanden online.");
    }
  });

  exportButton.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `categorieenboom-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  cancelDeleteButton.addEventListener("click", closeDeleteConfirmation);

  confirmDeleteButton.addEventListener("click", () => {
    if (!pendingDeleteId) {
      return;
    }

    removeNode(pendingDeleteId);
    editing = null;
    selectedEdge = null;
    closeDeleteConfirmation();
    saveState();
    render();
  });

  confirmOverlay.addEventListener("click", (event) => {
    if (event.target === confirmOverlay) {
      closeDeleteConfirmation();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !confirmOverlay.hidden) {
      closeDeleteConfirmation();
    }
  });

  window.addEventListener("resize", render);

  function startPanning(event) {
    if (event.button !== 0 || isInteractivePanTarget(event.target)) {
      return;
    }

    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: workspace.scrollLeft,
      startScrollTop: workspace.scrollTop,
      moved: false
    };
    workspace.setPointerCapture(event.pointerId);
    workspace.classList.add("is-panning");
  }

  function movePanning(event) {
    if (!panState || event.pointerId !== panState.pointerId) {
      return;
    }

    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;

    if (!panState.moved && Math.hypot(deltaX, deltaY) < 4) {
      return;
    }

    panState.moved = true;
    workspace.scrollLeft = panState.startScrollLeft - deltaX;
    workspace.scrollTop = panState.startScrollTop - deltaY;
    event.preventDefault();
  }

  function stopPanning(event) {
    if (!panState || event.pointerId !== panState.pointerId) {
      return;
    }

    suppressClickAfterPan = panState.moved && event.type === "pointerup";
    if (suppressClickAfterPan) {
      window.setTimeout(() => {
        suppressClickAfterPan = false;
      }, 0);
    }
    if (workspace.hasPointerCapture(event.pointerId)) {
      workspace.releasePointerCapture(event.pointerId);
    }
    workspace.classList.remove("is-panning");
    panState = null;
  }

  function isInteractivePanTarget(target) {
    return Boolean(target.closest(".node, button, input, .edge-hit"));
  }

  function render() {
    layout = calculateLayout(state.roots);
    workspace.classList.toggle("has-nodes", state.roots.length > 0);
    renderStats();
    setCanvasSize(layout.width, layout.height);
    renderConnections();
    renderNodes();
    focusEditingInput();
  }

  function renderStats() {
    const rootSizes = state.roots.map(countNodes);
    const total = rootSizes.reduce((sum, size) => sum + size, 0);
    const largest = rootSizes.length > 0 ? Math.max(...rootSizes) : 0;

    totalCount.textContent = total;
    largestCount.textContent = largest;
  }

  function countNodes(node) {
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
  }

  function renderNodes() {
    treeLayer.innerHTML = "";

    for (const nodeLayout of layout.nodes.values()) {
      const node = nodeLayout.node;
      const rootHue = ROOT_HUES[nodeLayout.rootIndex % ROOT_HUES.length];
      const depthLightness = Math.min(68, 45 + nodeLayout.depth * 6);
      const element = document.createElement("div");

      element.className = "node";
      element.dataset.id = node.id;
      element.style.left = `${nodeLayout.x}px`;
      element.style.top = `${nodeLayout.y}px`;
      element.style.setProperty("--hue", rootHue);
      element.style.setProperty("--light-1", `${depthLightness + 8}%`);
      element.style.setProperty("--light-2", `${depthLightness}%`);

      if (editing && editing.id === node.id) {
        element.classList.add("is-editing");
        element.appendChild(createInput(node));
      } else {
        const label = document.createElement("span");
        label.className = "node-label";
        label.textContent = node.label;
        element.appendChild(label);

        const addButton = document.createElement("button");
        addButton.type = "button";
        addButton.className = "node-action add";
        addButton.dataset.action = "add-child";
        addButton.dataset.id = node.id;
        addButton.title = "Subcategorie toevoegen";
        addButton.setAttribute("aria-label", `Subcategorie toevoegen onder ${node.label}`);
        addButton.textContent = "+";
        element.appendChild(addButton);

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "node-action delete";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.id = node.id;
        deleteButton.title = "Verwijderen";
        deleteButton.setAttribute("aria-label", `${node.label} verwijderen`);
        deleteButton.textContent = "×";
        element.appendChild(deleteButton);
      }

      treeLayer.appendChild(element);
    }

    renderRootButton();
    renderEdgePlus();
  }

  function renderEdgePlus() {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "edge-plus";
    button.dataset.action = "insert-edge";
    button.title = "Categorie ertussen zetten";
    button.setAttribute("aria-label", "Categorie ertussen zetten");
    button.textContent = "+";
    button.addEventListener("pointerenter", cancelEdgePlusHide);
    button.addEventListener("pointerleave", scheduleEdgePlusHide);
    treeLayer.appendChild(button);
  }

  function showEdgePlus(parentId, childId) {
    cancelEdgePlusHide();
    const edge = layout.edges.find((item) => {
      return item.parent.id === parentId && item.child.id === childId;
    });
    const button = treeLayer.querySelector(".edge-plus");

    if (!edge || !button) {
      return;
    }

    selectedEdge = { parentId, childId };
    button.dataset.parentId = parentId;
    button.dataset.childId = childId;
    button.style.left = `${edge.midX}px`;
    button.style.top = `${edge.midY}px`;
    button.classList.add("is-visible");
  }

  function scheduleEdgePlusHide() {
    cancelEdgePlusHide();
    edgeHoverTimer = window.setTimeout(hideEdgePlus, 120);
  }

  function cancelEdgePlusHide() {
    if (edgeHoverTimer !== null) {
      window.clearTimeout(edgeHoverTimer);
      edgeHoverTimer = null;
    }
  }

  function hideEdgePlus() {
    edgeHoverTimer = null;
    selectedEdge = null;
    const button = treeLayer.querySelector(".edge-plus");
    if (button) {
      button.classList.remove("is-visible");
    }
  }

  function renderRootButton() {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "root-plus";
    button.dataset.action = "add-root";
    button.title = "Hoofdcategorie toevoegen";
    button.setAttribute("aria-label", "Hoofdcategorie toevoegen");
    button.textContent = "+";
    button.style.left = `${state.roots.length > 0 ? layout.nextRootX : workspace.clientWidth / 2}px`;
    button.style.top = `${PADDING_TOP}px`;
    treeLayer.appendChild(button);
  }

  function renderConnections() {
    connections.innerHTML = "";

    for (const edge of layout.edges) {
      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const visiblePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const isSelected = selectedEdge &&
        selectedEdge.parentId === edge.parent.id &&
        selectedEdge.childId === edge.child.id;

      hitPath.setAttribute("d", edge.path);
      hitPath.setAttribute("class", "edge-hit");
      hitPath.dataset.parentId = edge.parent.id;
      hitPath.dataset.childId = edge.child.id;

      visiblePath.setAttribute("d", edge.path);
      visiblePath.setAttribute("class", isSelected ? "edge selected" : "edge");

      connections.appendChild(hitPath);
      connections.appendChild(visiblePath);
    }
  }

  function createInput(node) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = node.label;
    input.maxLength = 28;
    input.placeholder = "Woord";
    input.setAttribute("aria-label", "Categorienaam");

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commitEdit(node.id, input.value);
      }

      if (event.key === "Escape") {
        cancelEdit(node.id);
      }
    });

    input.addEventListener("blur", () => {
      if (editing && editing.id === node.id) {
        commitEdit(node.id, input.value);
      }
    });

    return input;
  }

  function focusEditingInput() {
    if (!editing) {
      return;
    }

    window.requestAnimationFrame(() => {
      const input = treeLayer.querySelector(".node.is-editing input");
      if (!input) {
        return;
      }

      input.focus();
      input.select();
    });
  }

  function addChild(parentId) {
    const parent = findNode(parentId);
    if (!parent) {
      return;
    }

    const child = createNode("");
    parent.children.push(child);
    editing = { id: child.id, isNew: true, kind: "new" };
    selectedEdge = null;
    saveState();
    render();
  }

  function addRoot() {
    selectedEdge = null;
    const node = createNode("");
    state.roots.push(node);
    editing = { id: node.id, isNew: true, kind: "new" };
    saveState();
    render();
  }

  function insertBetween(parentId, childId) {
    const parent = findNode(parentId);
    if (!parent) {
      return;
    }

    const childIndex = parent.children.findIndex((child) => child.id === childId);
    if (childIndex === -1) {
      return;
    }

    const oldChild = parent.children[childIndex];
    const middle = createNode("");
    middle.children.push(oldChild);
    parent.children[childIndex] = middle;
    editing = {
      id: middle.id,
      isNew: true,
      kind: "inserted",
      parentId,
      childId
    };
    selectedEdge = null;
    saveState();
    render();
  }

  function deleteNode(nodeId) {
    const node = findNode(nodeId);
    if (!node) {
      return;
    }

    selectedEdge = null;
    pendingDeleteId = nodeId;
    confirmMessage.textContent = node.children.length > 0
      ? `"${node.label}" heeft subcategorieen. Alles daaronder wordt ook verwijderd.`
      : `Weet je zeker dat je "${node.label}" wilt verwijderen?`;
    confirmOverlay.hidden = false;
    confirmDeleteButton.focus();
  }

  function closeDeleteConfirmation() {
    pendingDeleteId = null;
    confirmOverlay.hidden = true;
  }

  function commitEdit(nodeId, rawValue) {
    const value = cleanLabel(rawValue);
    const node = findNode(nodeId);
    if (!node) {
      editing = null;
      render();
      return;
    }

    if (!value) {
      if (editing && editing.isNew) {
        discardNewNode(editing);
      }
      editing = null;
      saveState();
      render();
      return;
    }

    node.label = value;
    editing = null;
    saveState();
    render();
  }

  function cancelEdit(nodeId) {
    const editToCancel = editing;
    editing = null;

    if (editToCancel && editToCancel.id === nodeId && editToCancel.isNew) {
      discardNewNode(editToCancel);
      saveState();
    }

    render();
  }

  function discardNewNode(editState) {
    if (editState.kind !== "inserted") {
      removeNode(editState.id);
      return;
    }

    const parent = findNode(editState.parentId);
    if (!parent) {
      return;
    }

    const middleIndex = parent.children.findIndex((child) => child.id === editState.id);
    if (middleIndex === -1) {
      return;
    }

    const middle = parent.children[middleIndex];
    const originalChild = middle.children.find((child) => child.id === editState.childId);
    if (originalChild) {
      parent.children[middleIndex] = originalChild;
    }
  }

  function calculateLayout(roots) {
    const nodes = new Map();
    const edges = [];
    let nextLeaf = 0;
    let maxDepth = 0;

    function walk(node, depth, rootIndex) {
      maxDepth = Math.max(maxDepth, depth);

      if (!Array.isArray(node.children) || node.children.length === 0) {
        const x = PADDING_X + nextLeaf * (NODE_WIDTH + H_GAP);
        nextLeaf += 1;
        nodes.set(node.id, {
          node,
          x,
          y: PADDING_TOP + depth * V_GAP,
          depth,
          rootIndex
        });
        return x;
      }

      const childXs = node.children.map((child) => walk(child, depth + 1, rootIndex));
      const x = (childXs[0] + childXs[childXs.length - 1]) / 2;
      nodes.set(node.id, {
        node,
        x,
        y: PADDING_TOP + depth * V_GAP,
        depth,
        rootIndex
      });
      return x;
    }

    roots.forEach((root, index) => walk(root, 0, index));

    for (const nodeLayout of nodes.values()) {
      for (const child of nodeLayout.node.children) {
        const childLayout = nodes.get(child.id);
        if (!childLayout) {
          continue;
        }

        edges.push(createEdge(nodeLayout, childLayout));
      }
    }

    const nextRootX = PADDING_X + nextLeaf * (NODE_WIDTH + H_GAP);
    const width = Math.max(
      workspace.clientWidth,
      nextRootX + NODE_WIDTH / 2 + PADDING_X
    );
    const height = Math.max(
      workspace.clientHeight,
      PADDING_TOP + PADDING_BOTTOM + (maxDepth + 1) * V_GAP
    );

    return { nodes, edges, width, height, nextRootX };
  }

  function createEdge(parentLayout, childLayout) {
    const startX = parentLayout.x;
    const startY = parentLayout.y + NODE_HEIGHT / 2 - 2;
    const endX = childLayout.x;
    const endY = childLayout.y - NODE_HEIGHT / 2 + 2;
    const midY = (startY + endY) / 2;
    const path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

    return {
      parent: parentLayout.node,
      child: childLayout.node,
      path,
      midX: (startX + endX) / 2,
      midY
    };
  }

  function setCanvasSize(width, height) {
    treeLayer.style.width = `${width}px`;
    treeLayer.style.height = `${height}px`;
    connections.style.width = `${width}px`;
    connections.style.height = `${height}px`;
    connections.setAttribute("width", width);
    connections.setAttribute("height", height);
    connections.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  function createNode(label) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `node-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      children: []
    };
  }

  function findNode(nodeId) {
    let result = null;

    visitNodes((node) => {
      if (node.id === nodeId) {
        result = node;
      }
    });

    return result;
  }

  function removeNode(nodeId) {
    const rootIndex = state.roots.findIndex((node) => node.id === nodeId);
    if (rootIndex !== -1) {
      state.roots.splice(rootIndex, 1);
      return true;
    }

    let removed = false;
    visitNodes((node) => {
      if (removed) {
        return;
      }

      const childIndex = node.children.findIndex((child) => child.id === nodeId);
      if (childIndex !== -1) {
        node.children.splice(childIndex, 1);
        removed = true;
      }
    });

    return removed;
  }

  function visitNodes(callback) {
    function visit(node) {
      callback(node);
      node.children.forEach(visit);
    }

    state.roots.forEach(visit);
  }

  function cleanLabel(value) {
    return value.trim().replace(/\s+/g, " ").slice(0, 28);
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return { version: 1, roots: [] };
    }

    try {
      return normalizeState(JSON.parse(saved));
    } catch (error) {
      return { version: 1, roots: [] };
    }
  }

  function normalizeState(rawState) {
    const seenIds = new Set();

    function normalizeNode(rawNode) {
      const fallback = createNode("");
      const id = typeof rawNode.id === "string" && rawNode.id && !seenIds.has(rawNode.id)
        ? rawNode.id
        : fallback.id;

      seenIds.add(id);

      return {
        id,
        label: cleanLabel(typeof rawNode.label === "string" ? rawNode.label : "Nieuw"),
        children: Array.isArray(rawNode.children) ? rawNode.children.map(normalizeNode) : []
      };
    }

    return {
      version: 1,
      roots: Array.isArray(rawState.roots) ? rawState.roots.map(normalizeNode) : []
    };
  }
})();
