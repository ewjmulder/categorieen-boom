(function () {
  "use strict";

  const STORAGE_KEY = "arend-categorieenboom-v1";
  const NODE_WIDTH = 124;
  const NODE_HEIGHT = 48;
  const WORD_NODE_HEIGHT = 42;
  const H_GAP = 28;
  const V_GAP = 84;
  const PADDING_X = 68;
  const PADDING_TOP = 60;
  const PADDING_BOTTOM = 68;
  const ROOT_HUES = [212, 142, 275, 24, 336, 184, 45, 250, 7, 103];
  const WORD_HUES = [28, 190, 328, 92, 252];
  const DEFAULT_WORDS = [
    { id: "olifant", label: "Olifant", variant: 0 },
    { id: "dolfijn", label: "Dolfijn", variant: 1 },
    { id: "stoel", label: "Stoel", variant: 2 },
    { id: "fiets", label: "Fiets", variant: 3 },
    { id: "appel", label: "Appel", variant: 4 },
    { id: "brood", label: "Brood", variant: 0 },
    { id: "tulp", label: "Tulp", variant: 1 },
    { id: "kasteel", label: "Kasteel", variant: 2 },
    { id: "lepel", label: "Lepel", variant: 3 },
    { id: "trein", label: "Trein", variant: 4 }
  ];

  const workspace = document.querySelector("#workspace");
  const treeLayer = document.querySelector("#tree");
  const connections = document.querySelector("#connections");
  const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
  const modeDescription = document.querySelector("#mode-description");
  const modeBadge = document.querySelector("#mode-badge");
  const emptyHint = document.querySelector("#empty-hint");
  const wordTray = document.querySelector("#word-tray");
  const wordList = document.querySelector("#word-list");
  const wordProgress = document.querySelector("#word-progress");
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
  let mode = "build";
  let wordBank = DEFAULT_WORDS;
  let wordDrag = null;
  let wordAutoScrollFrame = null;
  let layout = {
    nodes: new Map(),
    edges: [],
    width: 900,
    height: 520
  };

  render();
  loadWordBank();

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

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

  wordList.addEventListener("pointerdown", startWordDrag);
  document.addEventListener("pointermove", moveWordDrag);
  document.addEventListener("pointerup", stopWordDrag);
  document.addEventListener("pointercancel", cancelWordDrag);

  treeLayer.addEventListener("click", (event) => {
    if (mode !== "build") {
      return;
    }

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
    if (mode !== "build") {
      return;
    }

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
    if (mode !== "build") {
      return;
    }

    const edge = event.target.closest(".edge-hit");
    if (!edge) {
      return;
    }

    showEdgePlus(edge.dataset.parentId, edge.dataset.childId);
  });

  connections.addEventListener("pointerout", (event) => {
    if (mode !== "build") {
      return;
    }

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
    if (event.key === "Escape" && wordDrag) {
      cancelWordDrag(event);
    }
  });

  window.addEventListener("resize", render);

  function setMode(nextMode) {
    if (!["build", "place"].includes(nextMode) || nextMode === mode) {
      return;
    }

    mode = nextMode;
    selectedEdge = null;
    hideEdgePlus();
    clearDropTarget();
    cancelWordDrag();
    render();
  }

  async function loadWordBank() {
    try {
      const response = await fetch("woorden.json", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const rawWords = await response.json();
      const words = normalizeWords(rawWords);
      if (words.length > 0) {
        wordBank = words;
        render();
      }
    } catch (error) {
      wordBank = DEFAULT_WORDS;
    }
  }

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
    return Boolean(target.closest(".node, button, input, .edge-hit, .word-card"));
  }

  function startWordDrag(event) {
    const card = event.target.closest(".word-card");
    if (!card || mode !== "place") {
      return;
    }

    const word = findWord(card.dataset.wordId);
    if (!word) {
      return;
    }

    event.preventDefault();
    card.setPointerCapture(event.pointerId);
    wordDrag = {
      pointerId: event.pointerId,
      word,
      ghost: createWordGhost(word),
      targetCategoryId: null,
      clientX: event.clientX,
      clientY: event.clientY
    };
    document.body.classList.add("is-word-dragging");
    updateWordDrag(event.clientX, event.clientY);
    startWordAutoScroll();
  }

  function moveWordDrag(event) {
    if (!wordDrag || event.pointerId !== wordDrag.pointerId) {
      return;
    }

    event.preventDefault();
    updateWordDrag(event.clientX, event.clientY);
  }

  function stopWordDrag(event) {
    if (!wordDrag || event.pointerId !== wordDrag.pointerId) {
      return;
    }

    const targetCategoryId = wordDrag.targetCategoryId;
    const wordId = wordDrag.word.id;
    cleanupWordDrag();

    if (targetCategoryId) {
      placeWord(wordId, targetCategoryId);
    }
  }

  function cancelWordDrag() {
    if (!wordDrag) {
      return;
    }

    cleanupWordDrag();
  }

  function cleanupWordDrag() {
    stopWordAutoScroll();
    clearDropTarget();
    if (wordDrag && wordDrag.ghost) {
      wordDrag.ghost.remove();
    }
    wordDrag = null;
    document.body.classList.remove("is-word-dragging");
  }

  function createWordGhost(word) {
    const ghost = document.createElement("div");
    ghost.className = "word-drag-ghost";
    ghost.textContent = word.label;
    ghost.style.setProperty("--word-hue", getWordHue(word.variant));
    document.body.appendChild(ghost);
    return ghost;
  }

  function updateWordDrag(clientX, clientY) {
    if (!wordDrag) {
      return;
    }

    wordDrag.clientX = clientX;
    wordDrag.clientY = clientY;
    wordDrag.ghost.style.left = `${clientX}px`;
    wordDrag.ghost.style.top = `${clientY}px`;
    updateDropTarget(clientX, clientY);
  }

  function updateDropTarget(clientX, clientY) {
    if (!wordDrag) {
      return;
    }

    const categoryNode = document
      .elementsFromPoint(clientX, clientY)
      .find((element) => element.classList && element.classList.contains("category-node"));
    const categoryId = categoryNode ? categoryNode.dataset.categoryId : null;

    if (categoryId === wordDrag.targetCategoryId) {
      return;
    }

    clearDropTarget();
    wordDrag.targetCategoryId = categoryId;
    if (categoryNode) {
      categoryNode.classList.add("is-drop-target");
    }
  }

  function clearDropTarget() {
    treeLayer.querySelectorAll(".is-drop-target").forEach((element) => {
      element.classList.remove("is-drop-target");
    });
    if (wordDrag) {
      wordDrag.targetCategoryId = null;
    }
  }

  function startWordAutoScroll() {
    stopWordAutoScroll();
    wordAutoScrollFrame = window.requestAnimationFrame(runWordAutoScroll);
  }

  function stopWordAutoScroll() {
    if (wordAutoScrollFrame !== null) {
      window.cancelAnimationFrame(wordAutoScrollFrame);
      wordAutoScrollFrame = null;
    }
  }

  function runWordAutoScroll() {
    if (!wordDrag) {
      wordAutoScrollFrame = null;
      return;
    }

    const rect = workspace.getBoundingClientRect();
    const threshold = 78;
    const maxSpeed = 18;
    let speedX = 0;
    let speedY = 0;

    if (wordDrag.clientX >= rect.left && wordDrag.clientX <= rect.right) {
      if (wordDrag.clientX - rect.left < threshold) {
        speedX = -edgeScrollSpeed(threshold - (wordDrag.clientX - rect.left), threshold, maxSpeed);
      } else if (rect.right - wordDrag.clientX < threshold) {
        speedX = edgeScrollSpeed(threshold - (rect.right - wordDrag.clientX), threshold, maxSpeed);
      }
    }

    if (wordDrag.clientY >= rect.top && wordDrag.clientY <= rect.bottom) {
      if (wordDrag.clientY - rect.top < threshold) {
        speedY = -edgeScrollSpeed(threshold - (wordDrag.clientY - rect.top), threshold, maxSpeed);
      } else if (rect.bottom - wordDrag.clientY < threshold) {
        speedY = edgeScrollSpeed(threshold - (rect.bottom - wordDrag.clientY), threshold, maxSpeed);
      }
    }

    if (speedX !== 0 || speedY !== 0) {
      workspace.scrollLeft += speedX;
      workspace.scrollTop += speedY;
      updateDropTarget(wordDrag.clientX, wordDrag.clientY);
    }

    wordAutoScrollFrame = window.requestAnimationFrame(runWordAutoScroll);
  }

  function edgeScrollSpeed(distance, threshold, maxSpeed) {
    const ratio = Math.min(1, Math.max(0, distance / threshold));
    return Math.ceil(ratio * maxSpeed);
  }

  function render() {
    document.body.classList.toggle("place-mode", mode === "place");
    const displayRoots = mode === "place" ? buildDisplayRoots() : state.roots;

    layout = calculateLayout(displayRoots);
    workspace.classList.toggle("has-nodes", state.roots.length > 0);
    modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    modeDescription.textContent = mode === "build"
      ? "Maak categorieen en ontdek hoe ze onder elkaar passen."
      : "Sleep concrete woorden naar de categorie waar jij ze vindt passen.";
    modeBadge.textContent = mode === "build" ? "Bouwmodus" : "Plaatsmodus";
    emptyHint.textContent = mode === "build"
      ? "Beweeg hier met de muis om je eerste hoofdcategorie te maken."
      : "Maak eerst een categorie in Bouwmodus om woorden te kunnen plaatsen.";
    wordTray.hidden = mode !== "place";
    renderStats();
    renderWordTray();
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

  function renderWordTray() {
    if (mode !== "place") {
      wordList.innerHTML = "";
      return;
    }

    const validPlacements = getValidPlacements();
    const placedWordIds = new Set(validPlacements.map((placement) => placement.wordId));
    const availableWords = wordBank.filter((word) => !placedWordIds.has(word.id));

    wordProgress.textContent = `${placedWordIds.size} van ${wordBank.length} geplaatst`;
    wordList.innerHTML = "";

    if (availableWords.length === 0) {
      const empty = document.createElement("div");
      empty.className = "word-list-empty";
      empty.textContent = "Alle woorden zijn geplaatst.";
      wordList.appendChild(empty);
      return;
    }

    for (const word of availableWords) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "word-card";
      card.dataset.wordId = word.id;
      card.style.setProperty("--word-hue", getWordHue(word.variant));
      card.textContent = word.label;
      card.title = `${word.label} plaatsen`;
      wordList.appendChild(card);
    }
  }

  function buildDisplayRoots() {
    const categoryMap = new Map();
    const wordMap = new Map(wordBank.map((word) => [word.id, word]));

    function cloneCategory(node) {
      const clone = {
        id: node.id,
        label: node.label,
        type: "category",
        children: node.children.map(cloneCategory)
      };
      categoryMap.set(clone.id, clone);
      return clone;
    }

    const roots = state.roots.map(cloneCategory);

    for (const placement of getValidPlacements()) {
      const word = wordMap.get(placement.wordId);
      const category = categoryMap.get(placement.categoryId);
      if (!word || !category) {
        continue;
      }

      category.children.push({
        id: `word-${word.id}`,
        label: word.label,
        type: "word",
        wordId: word.id,
        variant: word.variant,
        children: []
      });
    }

    return roots;
  }

  function placeWord(wordId, categoryId) {
    if (!findNode(categoryId) || !findWord(wordId)) {
      return;
    }

    state.placements = getValidPlacements().filter((placement) => placement.wordId !== wordId);
    state.placements.push({ wordId, categoryId });
    saveState();
    render();
  }

  function getValidPlacements() {
    const categoryIds = new Set();
    visitNodes((node) => categoryIds.add(node.id));
    const seenWordIds = new Set();
    const placements = [];

    for (const placement of state.placements || []) {
      if (
        typeof placement.wordId !== "string" ||
        typeof placement.categoryId !== "string" ||
        !categoryIds.has(placement.categoryId) ||
        seenWordIds.has(placement.wordId)
      ) {
        continue;
      }

      seenWordIds.add(placement.wordId);
      placements.push({
        wordId: placement.wordId,
        categoryId: placement.categoryId
      });
    }

    return placements;
  }

  function findWord(wordId) {
    return wordBank.find((word) => word.id === wordId);
  }

  function getWordHue(variant) {
    return WORD_HUES[Math.abs(Number(variant) || 0) % WORD_HUES.length];
  }

  function renderNodes() {
    treeLayer.innerHTML = "";

    for (const nodeLayout of layout.nodes.values()) {
      const node = nodeLayout.node;
      const rootHue = ROOT_HUES[nodeLayout.rootIndex % ROOT_HUES.length];
      const depthLightness = Math.min(68, 45 + nodeLayout.depth * 6);
      const element = document.createElement("div");
      const isWord = node.type === "word";

      element.className = isWord ? "node word-node" : "node category-node";
      element.dataset.id = node.id;
      if (!isWord) {
        element.dataset.categoryId = node.id;
      }
      element.style.left = `${nodeLayout.x}px`;
      element.style.top = `${nodeLayout.y}px`;
      element.style.setProperty("--hue", rootHue);
      element.style.setProperty("--light-1", `${depthLightness + 8}%`);
      element.style.setProperty("--light-2", `${depthLightness}%`);
      if (isWord) {
        element.style.setProperty("--word-hue", getWordHue(node.variant));
      }

      if (!isWord && mode === "build" && editing && editing.id === node.id) {
        element.classList.add("is-editing");
        element.appendChild(createInput(node));
      } else {
        const label = document.createElement("span");
        label.className = "node-label";
        label.textContent = node.label;
        element.appendChild(label);

        if (!isWord && mode === "build") {
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
      }

      treeLayer.appendChild(element);
    }

    if (mode === "build") {
      renderRootButton();
      renderEdgePlus();
    }
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
      const visiblePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const isSelected = selectedEdge &&
        selectedEdge.parentId === edge.parent.id &&
        selectedEdge.childId === edge.child.id;

      visiblePath.setAttribute("d", edge.path);
      visiblePath.setAttribute(
        "class",
        edge.isWord ? "edge word-edge" : isSelected ? "edge selected" : "edge"
      );

      if (mode === "build" && !edge.isWord) {
        const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        hitPath.setAttribute("d", edge.path);
        hitPath.setAttribute("class", "edge-hit");
        hitPath.dataset.parentId = edge.parent.id;
        hitPath.dataset.childId = edge.child.id;
        connections.appendChild(hitPath);
      }
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
    const contentWidth = mode === "build"
      ? nextRootX + NODE_WIDTH / 2 + PADDING_X
      : nextLeaf > 0
        ? nextRootX - NODE_WIDTH / 2 - H_GAP + PADDING_X
        : workspace.clientWidth;
    const width = Math.max(workspace.clientWidth, contentWidth);
    const height = Math.max(
      workspace.clientHeight,
      PADDING_TOP + PADDING_BOTTOM + (maxDepth + 1) * V_GAP
    );

    return { nodes, edges, width, height, nextRootX };
  }

  function createEdge(parentLayout, childLayout) {
    const childHeight = childLayout.node.type === "word" ? WORD_NODE_HEIGHT : NODE_HEIGHT;
    const startX = parentLayout.x;
    const startY = parentLayout.y + NODE_HEIGHT / 2 - 2;
    const endX = childLayout.x;
    const endY = childLayout.y - childHeight / 2 + 2;
    const midY = (startY + endY) / 2;
    const path = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;

    return {
      parent: parentLayout.node,
      child: childLayout.node,
      path,
      midX: (startX + endX) / 2,
      midY,
      isWord: childLayout.node.type === "word"
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
    const nodeToRemove = findNode(nodeId);
    const removedCategoryIds = new Set();
    if (nodeToRemove) {
      collectNodeIds(nodeToRemove, removedCategoryIds);
    }

    const rootIndex = state.roots.findIndex((node) => node.id === nodeId);
    if (rootIndex !== -1) {
      state.roots.splice(rootIndex, 1);
      removePlacementsForCategories(removedCategoryIds);
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
        removePlacementsForCategories(removedCategoryIds);
        removed = true;
      }
    });

    return removed;
  }

  function collectNodeIds(node, ids) {
    ids.add(node.id);
    node.children.forEach((child) => collectNodeIds(child, ids));
  }

  function removePlacementsForCategories(categoryIds) {
    if (!categoryIds.size || !Array.isArray(state.placements)) {
      return;
    }

    state.placements = state.placements.filter((placement) => {
      return !categoryIds.has(placement.categoryId);
    });
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

    const roots = Array.isArray(rawState.roots) ? rawState.roots.map(normalizeNode) : [];
    const categoryIds = new Set();

    function collectCategoryIds(node) {
      categoryIds.add(node.id);
      node.children.forEach(collectCategoryIds);
    }

    roots.forEach(collectCategoryIds);

    const placements = [];
    const placedWordIds = new Set();
    if (Array.isArray(rawState.placements)) {
      for (const placement of rawState.placements) {
        if (
          typeof placement.wordId !== "string" ||
          typeof placement.categoryId !== "string" ||
          !categoryIds.has(placement.categoryId) ||
          placedWordIds.has(placement.wordId)
        ) {
          continue;
        }

        placedWordIds.add(placement.wordId);
        placements.push({
          wordId: placement.wordId,
          categoryId: placement.categoryId
        });
      }
    }

    return {
      version: 1,
      roots,
      placements
    };
  }

  function normalizeWords(rawWords) {
    const seenIds = new Set();
    if (!Array.isArray(rawWords)) {
      return [];
    }

    return rawWords.reduce((words, rawWord, index) => {
      const id = typeof rawWord.id === "string" ? rawWord.id.trim() : "";
      const label = cleanLabel(typeof rawWord.label === "string" ? rawWord.label : "");

      if (!id || !label || seenIds.has(id)) {
        return words;
      }

      seenIds.add(id);
      words.push({
        id,
        label,
        variant: Number.isInteger(rawWord.variant) ? rawWord.variant : index
      });
      return words;
    }, []);
  }
})();
