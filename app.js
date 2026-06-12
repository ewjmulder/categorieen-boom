(function () {
  "use strict";

  const STORAGE_KEY = "arend-categorieenboom-v2";
  const MAKER_STORAGE_KEY = "arend-categorieenboom-maker";
  const CLOUD_STATE_FORMAT = "arend-categorieenboom";
  const STATE_VERSION = 2;
  const FIREBASE_PROJECT_ID = "categorieen-boom";
  const FIREBASE_API_KEY = "AIzaSyBUFGvxW7492bWWu9bxDj1T1z3kervAlq8";
  const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const MAX_CLOUD_STATE_SIZE = 850000;
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
  const resetTreeButton = document.querySelector("#reset-tree");
  const loadExampleButton = document.querySelector("#load-example");
  const cloudTreesButton = document.querySelector("#cloud-trees");
  const cloudDialog = document.querySelector("#cloud-dialog");
  const closeCloudDialogButton = document.querySelector("#close-cloud-dialog");
  const saveCloudForm = document.querySelector("#save-cloud-form");
  const cloudTreeNameInput = document.querySelector("#cloud-tree-name");
  const cloudTreeMakerInput = document.querySelector("#cloud-tree-maker");
  const cloudNameLabel = document.querySelector("#cloud-name-label");
  const cloudMakerLabel = document.querySelector("#cloud-maker-label");
  const saveCloudTreeButton = document.querySelector("#save-cloud-tree");
  const refreshCloudTreesButton = document.querySelector("#refresh-cloud-trees");
  const cloudCurrentTitle = document.querySelector("#cloud-current-title");
  const cloudCurrentDescription = document.querySelector("#cloud-current-description");
  const cloudStatus = document.querySelector("#cloud-status");
  const cloudTreeList = document.querySelector("#cloud-tree-list");
  const totalCount = document.querySelector("#total-count");
  const largestCount = document.querySelector("#largest-count");
  const confirmOverlay = document.querySelector("#confirm-overlay");
  const confirmTitle = document.querySelector("#confirm-title");
  const confirmMessage = document.querySelector("#confirm-message");
  const cancelDeleteButton = document.querySelector("#cancel-delete");
  const confirmDeleteButton = document.querySelector("#confirm-delete");

  let state = loadState();
  let editing = null;
  let selectedEdge = null;
  let pendingConfirmation = null;
  let panState = null;
  let suppressClickAfterPan = false;
  let edgeHoverTimer = null;
  let viewSaveTimer = null;
  let mode = state.view.mode;
  let baseWordBank = state.baseWords.length > 0 ? state.baseWords : DEFAULT_WORDS;
  let wordBank = mergeWordBank();
  let isAddingWord = false;
  let wordDrag = null;
  let wordAutoScrollFrame = null;
  let layout = {
    nodes: new Map(),
    edges: [],
    width: 900,
    height: 520
  };

  persistState();
  render();
  restoreViewState();
  loadWordBank();

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  workspace.addEventListener("pointerdown", startPanning);
  workspace.addEventListener("pointermove", movePanning);
  workspace.addEventListener("pointerup", stopPanning);
  workspace.addEventListener("pointercancel", stopPanning);
  workspace.addEventListener("scroll", scheduleViewSave, { passive: true });
  workspace.addEventListener("click", (event) => {
    if (!suppressClickAfterPan) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressClickAfterPan = false;
  }, true);

  wordList.addEventListener("pointerdown", startWordDrag);
  wordList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-action='delete-word']");
    if (deleteButton) {
      event.preventDefault();
      event.stopPropagation();
      removeWord(deleteButton.dataset.wordId);
      return;
    }

    const addButton = event.target.closest("[data-action='add-word']");
    if (!addButton) {
      return;
    }

    isAddingWord = true;
    renderWordTray();
  });
  document.addEventListener("pointermove", moveWordDrag);
  document.addEventListener("pointerup", stopWordDrag);
  document.addEventListener("pointercancel", cancelWordDrag);

  treeLayer.addEventListener("pointerdown", startPlacedWordDrag);
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

  resetTreeButton.addEventListener("click", () => {
    if (state.roots.length === 0) {
      return;
    }

    openConfirmation({
      type: "reset",
      title: "Hele boom leegmaken?",
      message: "Alle categorieen, geplaatste woorden en zelf toegevoegde woorden worden definitief verwijderd.",
      confirmLabel: "Boom leegmaken"
    });
  });

  loadExampleButton.addEventListener("click", () => {
    if (hasSavedWork()) {
      openConfirmation({
        type: "load-example",
        title: "Voorbeeldboom laden?",
        message: "Dit vervangt je huidige boom, woorden en plaatsingen. Niet-online-opgeslagen wijzigingen gaan verloren.",
        confirmLabel: "Voorbeeld laden"
      });
      return;
    }

    loadExample();
  });

  async function loadExample() {
    try {
      const response = await fetch("voorbeeld.json", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Voorbeeldbestand kon niet worden geladen.");
      }

      const example = await response.json();
      validateState(example);
      state = normalizeState(example);
      wordBank = mergeWordBank();
      isAddingWord = false;
      editing = null;
      selectedEdge = null;
      saveState();
      render();
      restoreViewState();
    } catch (error) {
      window.alert("Het voorbeeld kon niet worden geladen. Start de app via een lokale webserver of publiceer de bestanden online.");
    }
  }

  cloudTreesButton.addEventListener("click", openCloudDialog);
  closeCloudDialogButton.addEventListener("click", closeCloudDialog);
  refreshCloudTreesButton.addEventListener("click", loadCloudTreeList);

  saveCloudForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveTreeToCloud();
  });

  cloudTreeList.addEventListener("click", async (event) => {
    const loadButton = event.target.closest("[data-cloud-tree-id]");
    if (!loadButton) {
      return;
    }

    await loadTreeFromCloud(loadButton.dataset.cloudTreeId);
  });

  cloudDialog.addEventListener("click", (event) => {
    if (event.target === cloudDialog) {
      closeCloudDialog();
    }
  });

  cloudDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCloudDialog();
  });

  cancelDeleteButton.addEventListener("click", closeConfirmation);

  confirmDeleteButton.addEventListener("click", async () => {
    if (!pendingConfirmation) {
      return;
    }

    if (pendingConfirmation.type === "reset") {
      resetTree();
      closeConfirmation();
      return;
    }

    if (pendingConfirmation.type === "load-example") {
      closeConfirmation();
      await loadExample();
      return;
    }

    removeNode(pendingConfirmation.nodeId);
    editing = null;
    selectedEdge = null;
    closeConfirmation();
    saveState();
    render();
  });

  confirmOverlay.addEventListener("click", (event) => {
    if (event.target === confirmOverlay) {
      closeConfirmation();
    }
  });

  confirmOverlay.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeConfirmation();
  });

  document.addEventListener("keydown", (event) => {
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
    saveState();
    render();
  }

  async function loadWordBank() {
    if (state.baseWords.length > 0) {
      baseWordBank = state.baseWords;
      wordBank = mergeWordBank();
      render();
      restoreViewState();
      return;
    }

    try {
      const response = await fetch("woorden.json", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const rawWords = await response.json();
      const words = normalizeWords(rawWords);
      if (words.length > 0) {
        baseWordBank = words;
        wordBank = mergeWordBank();
        render();
      }
    } catch (error) {
      baseWordBank = DEFAULT_WORDS;
      wordBank = mergeWordBank();
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
    if (event.button !== 0 || event.target.closest("[data-action='delete-word']")) {
      return;
    }

    const card = event.target.closest(".word-card");
    if (!card || mode !== "place") {
      return;
    }

    const word = findWord(card.dataset.wordId);
    if (!word) {
      return;
    }

    beginWordDrag(event, card, word);
  }

  function startPlacedWordDrag(event) {
    if (event.button !== 0 || mode !== "place") {
      return;
    }

    const wordNode = event.target.closest(".word-node");
    if (!wordNode) {
      return;
    }

    const word = findWord(wordNode.dataset.wordId);
    if (!word) {
      return;
    }

    beginWordDrag(event, wordNode, word);
  }

  function beginWordDrag(event, sourceElement, word) {
    event.preventDefault();
    sourceElement.setPointerCapture(event.pointerId);
    sourceElement.classList.add("is-being-dragged");
    wordDrag = {
      pointerId: event.pointerId,
      word,
      sourceElement,
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
    if (wordDrag && wordDrag.sourceElement) {
      wordDrag.sourceElement.classList.remove("is-being-dragged");
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
    resetTreeButton.disabled = state.roots.length === 0;
    renderStats();
    renderWordTray();
    setCanvasSize(layout.width, layout.height);
    renderConnections();
    renderNodes();
    focusEditingInput();
    updateCloudCurrentCard();
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
      isAddingWord = false;
      return;
    }

    const validPlacements = getValidPlacements();
    const placedWordIds = new Set(validPlacements.map((placement) => placement.wordId));
    const availableWords = wordBank.filter((word) => !placedWordIds.has(word.id));

    wordProgress.textContent = `${placedWordIds.size} van ${wordBank.length} geplaatst`;
    wordList.innerHTML = "";

    if (availableWords.length === 0 && !isAddingWord) {
      const empty = document.createElement("div");
      empty.className = "word-list-empty";
      empty.textContent = "Alle woorden zijn geplaatst.";
      wordList.appendChild(empty);
    }

    for (const word of availableWords) {
      const card = document.createElement("div");
      card.className = "word-card";
      card.dataset.wordId = word.id;
      card.style.setProperty("--word-hue", getWordHue(word.variant));
      card.title = `${word.label} plaatsen`;

      const label = document.createElement("span");
      label.className = "word-card-label";
      label.textContent = word.label;
      card.appendChild(label);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "word-card-delete";
      deleteButton.dataset.action = "delete-word";
      deleteButton.dataset.wordId = word.id;
      deleteButton.setAttribute("aria-label", `${word.label} verwijderen`);
      deleteButton.title = `${word.label} verwijderen`;
      deleteButton.textContent = "×";
      card.appendChild(deleteButton);

      wordList.appendChild(card);
    }

    if (isAddingWord) {
      wordList.appendChild(createWordInput());
    } else {
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "add-word-card";
      addButton.dataset.action = "add-word";
      addButton.title = "Zelf een woord toevoegen";
      addButton.setAttribute("aria-label", "Zelf een woord toevoegen");
      addButton.textContent = "+";
      wordList.appendChild(addButton);
    }
  }

  function createWordInput() {
    const wrapper = document.createElement("div");
    const input = document.createElement("input");

    wrapper.className = "word-card word-input-card";
    wrapper.style.setProperty("--word-hue", getWordHue(wordBank.length));
    input.type = "text";
    input.maxLength = 28;
    input.placeholder = "Nieuw woord";
    input.setAttribute("aria-label", "Nieuw concreet woord");
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        addCustomWord(input.value);
      }
      if (event.key === "Escape") {
        isAddingWord = false;
        renderWordTray();
      }
    });
    input.addEventListener("blur", () => {
      if (isAddingWord) {
        addCustomWord(input.value);
      }
    });
    wrapper.appendChild(input);

    window.requestAnimationFrame(() => input.focus());
    return wrapper;
  }

  function addCustomWord(rawLabel) {
    const label = cleanLabel(rawLabel);
    isAddingWord = false;

    if (!label) {
      renderWordTray();
      return;
    }

    const word = {
      id: `custom-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
      label,
      variant: Math.floor(Math.random() * WORD_HUES.length)
    };
    state.customWords.push(word);
    wordBank = mergeWordBank();
    saveState();
    render();
  }

  function mergeWordBank() {
    const words = [];
    const seenIds = new Set();
    const hiddenWords = new Set(state.hiddenWords || []);

    for (const word of [...baseWordBank, ...(state.customWords || [])]) {
      if (hiddenWords.has(word.id) || seenIds.has(word.id)) {
        continue;
      }
      seenIds.add(word.id);
      words.push(word);
    }

    return words;
  }

  function removeWord(wordId) {
    const word = findWord(wordId);
    if (!word) {
      return;
    }

    state.placements = (state.placements || []).filter(
      (placement) => placement.wordId !== wordId
    );

    if (wordId.startsWith("custom-")) {
      state.customWords = (state.customWords || []).filter(
        (customWord) => customWord.id !== wordId
      );
    } else {
      state.hiddenWords ||= [];
      if (!state.hiddenWords.includes(wordId)) {
        state.hiddenWords.push(wordId);
      }
    }

    wordBank = mergeWordBank();
    saveState();
    render();
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
      if (isWord) {
        element.dataset.wordId = node.wordId;
        element.title = `${node.label} naar een andere categorie slepen`;
      } else {
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
    button.style.left = `${layout.nextRootX}px`;
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
    openConfirmation({
      type: "delete",
      nodeId,
      title: "Categorie verwijderen?",
      message: node.children.length > 0
        ? `"${node.label}" heeft subcategorieen. Alles daaronder wordt ook verwijderd.`
        : `Weet je zeker dat je "${node.label}" wilt verwijderen?`,
      confirmLabel: "Verwijderen"
    });
  }

  function openConfirmation(action) {
    pendingConfirmation = action;
    confirmTitle.textContent = action.title;
    confirmMessage.textContent = action.message;
    confirmDeleteButton.textContent = action.confirmLabel;
    if (!confirmOverlay.open) {
      confirmOverlay.showModal();
    }
    confirmDeleteButton.focus();
  }

  function closeConfirmation() {
    pendingConfirmation = null;
    if (confirmOverlay.open) {
      confirmOverlay.close();
    }
  }

  function resetTree() {
    cancelWordDrag();
    state = createEmptyState();
    wordBank = mergeWordBank();
    isAddingWord = false;
    editing = null;
    selectedEdge = null;
    mode = "build";
    workspace.scrollLeft = 0;
    workspace.scrollTop = 0;
    saveState();
    render();
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

  function cleanTreeName(value) {
    return value.trim().replace(/\s+/g, " ").slice(0, 80);
  }

  function cleanMakerName(value) {
    return value.trim().replace(/\s+/g, " ").slice(0, 60);
  }

  function saveState() {
    syncViewState();
    persistState();
  }

  function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return createEmptyState();
    }

    try {
      const savedState = JSON.parse(saved);
      validateState(savedState);
      return normalizeState(savedState);
    } catch (error) {
      return createEmptyState();
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
        children: rawNode.children.map(normalizeNode)
      };
    }

    const roots = rawState.roots.map(normalizeNode);
    const categoryIds = new Set();

    function collectCategoryIds(node) {
      categoryIds.add(node.id);
      node.children.forEach(collectCategoryIds);
    }

    roots.forEach(collectCategoryIds);

    const placements = [];
    const placedWordIds = new Set();
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

    const customWords = normalizeWords(rawState.customWords).map((word) => ({
      ...word,
      id: word.id.startsWith("custom-") ? word.id : `custom-${word.id}`
    }));
    const hiddenWords = [...new Set(rawState.hiddenWords.filter((wordId) => typeof wordId === "string"))];
    const baseWords = normalizeWords(rawState.baseWords);
    const view = {
      mode: rawState.view.mode,
      scrollLeft: Math.round(rawState.view.scrollLeft),
      scrollTop: Math.round(rawState.view.scrollTop)
    };
    const cloud = normalizeCloudState(rawState.cloud);

    return {
      version: STATE_VERSION,
      roots,
      placements,
      customWords,
      hiddenWords,
      baseWords,
      view,
      cloud
    };
  }

  function createEmptyState() {
    return {
      version: STATE_VERSION,
      roots: [],
      placements: [],
      customWords: [],
      hiddenWords: [],
      baseWords: [],
      cloud: null,
      view: {
        mode: "build",
        scrollLeft: 0,
        scrollTop: 0
      }
    };
  }

  function createCloudState(cloudOverride = state.cloud) {
    syncViewState();
    return {
      format: CLOUD_STATE_FORMAT,
      version: STATE_VERSION,
      roots: state.roots,
      placements: state.placements,
      customWords: state.customWords,
      hiddenWords: state.hiddenWords,
      baseWords: baseWordBank,
      view: state.view,
      cloud: cloudOverride
    };
  }

  function parseCloudState(rawState) {
    if (!isRecord(rawState)) {
      throw new Error("De opgeslagen boom is ongeldig.");
    }

    if (rawState.format !== CLOUD_STATE_FORMAT) {
      throw new Error("De opgeslagen gegevens horen niet bij de categorieënboom.");
    }

    if (rawState.version !== STATE_VERSION) {
      throw new Error(`Versie ${String(rawState.version)} wordt niet ondersteund.`);
    }

    validateState(rawState);
    return normalizeState(rawState);
  }

  function validateState(rawState) {
    if (!isRecord(rawState) || rawState.version !== STATE_VERSION) {
      throw new Error(`Versie ${String(rawState && rawState.version)} wordt niet ondersteund.`);
    }

    ["roots", "placements", "customWords", "hiddenWords", "baseWords"].forEach((property) => {
      if (!Array.isArray(rawState[property])) {
        throw new Error(`Het veld "${property}" is ongeldig.`);
      }
    });
    rawState.roots.forEach(validateStateNode);

    if (!isRecord(rawState.view)) {
      throw new Error("De weergavestatus is ongeldig.");
    }

    if (
      !["build", "place"].includes(rawState.view.mode) ||
      !Number.isFinite(rawState.view.scrollLeft) ||
      rawState.view.scrollLeft < 0 ||
      !Number.isFinite(rawState.view.scrollTop) ||
      rawState.view.scrollTop < 0
    ) {
      throw new Error("De weergavestatus is ongeldig.");
    }

    if (rawState.cloud !== null) {
      validateCloudMetadata(rawState.cloud);
    }
  }

  function validateStateNode(node) {
    if (!isRecord(node)) {
      throw new Error("Een categorie in de boom is ongeldig.");
    }

    if (typeof node.id !== "string" || !node.id || typeof node.label !== "string") {
      throw new Error("Een categorie mist een geldig ID of label.");
    }

    if (!Array.isArray(node.children)) {
      throw new Error("De subcategorieën van een categorie zijn ongeldig.");
    }

    node.children.forEach(validateStateNode);
  }

  function validateCloudMetadata(rawCloud) {
    if (!isRecord(rawCloud)) {
      throw new Error("De online opslaggegevens ontbreken.");
    }

    const treeId = typeof rawCloud.treeId === "string" ? rawCloud.treeId.trim() : "";
    const name = typeof rawCloud.name === "string" ? cleanTreeName(rawCloud.name) : "";
    const maker = typeof rawCloud.maker === "string" ? cleanMakerName(rawCloud.maker) : "";
    if (!treeId || !name || !maker) {
      throw new Error("De online opslaggegevens zijn ongeldig.");
    }

    if (!Number.isInteger(rawCloud.revision) || rawCloud.revision < 1) {
      throw new Error("De online revisie is ongeldig.");
    }

    if (!normalizeIsoDate(rawCloud.createdAt) || !normalizeIsoDate(rawCloud.updatedAt)) {
      throw new Error("De online opslagdatums zijn ongeldig.");
    }
  }

  function requireFirestoreString(fields, property) {
    const value = fields[property] && fields[property].stringValue;
    if (typeof value !== "string" || !value) {
      throw new Error(`Het veld "${property}" is ongeldig.`);
    }
    return value;
  }

  function requireFirestoreInteger(fields, property) {
    const value = fields[property] && fields[property].integerValue;
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
      throw new Error(`Het veld "${property}" is ongeldig.`);
    }

    const number = Number(value);
    if (!Number.isInteger(number)) {
      throw new Error(`Het veld "${property}" is ongeldig.`);
    }
    return number;
  }

  function requireFirestoreTimestamp(fields, property) {
    const value = fields[property] && fields[property].timestampValue;
    if (!normalizeIsoDate(value)) {
      throw new Error(`Het veld "${property}" is ongeldig.`);
    }
    return value;
  }

  function applyLoadedState(loadedState) {
    cancelWordDrag();
    state = loadedState;
    baseWordBank = state.baseWords.length > 0 ? state.baseWords : DEFAULT_WORDS;
    wordBank = mergeWordBank();
    isAddingWord = false;
    editing = null;
    selectedEdge = null;
    mode = state.view.mode;
    persistState();
    render();
    restoreViewState();
  }

  function normalizeCloudState(rawCloud) {
    if (rawCloud === null) {
      return null;
    }

    return {
      treeId: rawCloud.treeId.trim(),
      name: cleanTreeName(rawCloud.name),
      maker: cleanMakerName(rawCloud.maker),
      revision: rawCloud.revision,
      createdAt: normalizeIsoDate(rawCloud.createdAt),
      updatedAt: normalizeIsoDate(rawCloud.updatedAt)
    };
  }

  function normalizeIsoDate(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      return null;
    }

    return new Date(value).toISOString();
  }

  function openCloudDialog() {
    updateCloudCurrentCard();
    if (!cloudDialog.open) {
      cloudDialog.showModal();
    }
    loadCloudTreeList();
  }

  function closeCloudDialog() {
    if (cloudDialog.open) {
      cloudDialog.close();
    }
  }

  function updateCloudCurrentCard() {
    const cloud = state.cloud;
    if (cloud) {
      cloudCurrentTitle.textContent = cloud.name;
      cloudCurrentDescription.textContent = `Gemaakt door ${cloud.maker} · online versie ${cloud.revision}.`;
      cloudNameLabel.textContent = "Opgeslagen naam";
      cloudMakerLabel.textContent = "Maker";
      cloudTreeNameInput.value = cloud.name;
      cloudTreeMakerInput.value = cloud.maker;
      cloudTreeNameInput.readOnly = true;
      cloudTreeMakerInput.readOnly = true;
      saveCloudTreeButton.textContent = "Wijzigingen opslaan";
      cloudTreesButton.title = `Online opgeslagen als "${cloud.name}"`;
      return;
    }

    cloudCurrentTitle.textContent = "Nog niet online opgeslagen";
    cloudCurrentDescription.textContent = "Geef de boom en de maker een naam om hem vanaf andere apparaten te openen.";
    cloudNameLabel.textContent = "Naam van de boom";
    cloudMakerLabel.textContent = "Maker";
    cloudTreeNameInput.readOnly = false;
    cloudTreeMakerInput.readOnly = false;
    cloudTreeNameInput.value = "";
    cloudTreeMakerInput.value = loadPreferredMaker();
    saveCloudTreeButton.textContent = "Online opslaan";
    cloudTreesButton.title = "Bomen online opslaan of laden";
  }

  async function saveTreeToCloud() {
    const existingCloud = state.cloud;
    const requestedName = existingCloud ? existingCloud.name : cleanTreeName(cloudTreeNameInput.value);
    const requestedMaker = existingCloud ? existingCloud.maker : cleanMakerName(cloudTreeMakerInput.value);
    if (!requestedName) {
      setCloudStatus("Vul eerst een naam voor de boom in.", true);
      cloudTreeNameInput.focus();
      return;
    }

    if (!requestedMaker) {
      setCloudStatus("Vul ook de naam van de maker in.", true);
      cloudTreeMakerInput.focus();
      return;
    }

    setCloudBusy(true);
    setCloudStatus("De volledige boom wordt online opgeslagen...");

    try {
      const now = new Date().toISOString();
      const treeId = existingCloud ? existingCloud.treeId : createId();
      const remoteTree = existingCloud ? await getCloudTreeDocument(treeId, true) : null;
      const revision = remoteTree ? remoteTree.revision + 1 : 1;
      const createdAt = remoteTree ? remoteTree.createdAt : now;
      const nextCloud = {
        treeId,
        name: requestedName,
        maker: requestedMaker,
        revision,
        createdAt,
        updatedAt: now
      };
      const cloudState = createCloudState(nextCloud);
      const serializedState = JSON.stringify(cloudState);
      if (new Blob([serializedState]).size > MAX_CLOUD_STATE_SIZE) {
        throw new Error("Deze boom is te groot om online op te slaan.");
      }

      await writeCloudTree(nextCloud, serializedState);
      state.cloud = nextCloud;
      savePreferredMaker(requestedMaker);
      persistState();
      updateCloudCurrentCard();
      await loadCloudTreeList(false);
      setCloudStatus(`"${requestedName}" van ${requestedMaker} is online opgeslagen als versie ${revision}.`);
    } catch (error) {
      setCloudStatus(firebaseErrorMessage(error, "Opslaan is niet gelukt."), true);
    } finally {
      setCloudBusy(false);
    }
  }

  async function loadCloudTreeList(showLoading = true) {
    refreshCloudTreesButton.disabled = true;
    if (showLoading) {
      setCloudStatus("Beschikbare bomen worden geladen...");
      cloudTreeList.innerHTML = "";
    }

    try {
      const trees = await listCloudTrees();
      renderCloudTreeList(trees);
      setCloudStatus(trees.length === 0
        ? "Er zijn nog geen bomen online opgeslagen."
        : `${trees.length} ${trees.length === 1 ? "boom is" : "bomen zijn"} beschikbaar.`);
    } catch (error) {
      setCloudStatus(firebaseErrorMessage(error, "De bomen konden niet worden geladen."), true);
    } finally {
      refreshCloudTreesButton.disabled = false;
    }
  }

  function renderCloudTreeList(trees) {
    cloudTreeList.innerHTML = "";

    for (const tree of trees) {
      const item = document.createElement("article");
      const details = document.createElement("div");
      const name = document.createElement("span");
      const maker = document.createElement("span");
      const meta = document.createElement("span");
      const button = document.createElement("button");
      const isCurrent = state.cloud && state.cloud.treeId === tree.treeId;

      item.className = `cloud-tree-item${isCurrent ? " is-current" : ""}`;
      name.className = "cloud-tree-name";
      name.textContent = tree.name;
      maker.className = "cloud-tree-maker";
      maker.textContent = `Gemaakt door ${tree.maker}`;
      meta.className = "cloud-tree-meta";
      meta.textContent = `${formatCloudDate(tree.updatedAt)} · ${tree.categoryCount} categorieën · ${tree.placedWordCount} geplaatst · versie ${tree.revision}`;
      button.type = "button";
      button.dataset.cloudTreeId = tree.treeId;
      button.textContent = isCurrent ? "Opnieuw laden" : "Laden";
      details.append(name, maker, meta);
      item.append(details, button);
      cloudTreeList.appendChild(item);
    }
  }

  async function loadTreeFromCloud(treeId) {
    if (hasSavedWork() && !window.confirm("Dit vervangt je huidige boom en niet-online-opgeslagen wijzigingen. Weet je het zeker?")) {
      return;
    }

    setCloudBusy(true);
    setCloudStatus("De gekozen boom wordt geladen...");

    try {
      const cloudTree = await getCloudTreeDocument(treeId);
      if (!cloudTree) {
        throw new Error("Deze boom bestaat niet meer.");
      }

      const loadedState = parseCloudState(JSON.parse(cloudTree.serializedState));
      loadedState.cloud = {
        treeId: cloudTree.treeId,
        name: cloudTree.name,
        maker: cloudTree.maker,
        revision: cloudTree.revision,
        createdAt: cloudTree.createdAt,
        updatedAt: cloudTree.updatedAt
      };
      savePreferredMaker(cloudTree.maker);
      applyLoadedState(loadedState);
      closeCloudDialog();
    } catch (error) {
      setCloudStatus(firebaseErrorMessage(error, "Laden is niet gelukt."), true);
    } finally {
      setCloudBusy(false);
    }
  }

  async function listCloudTrees() {
    const trees = [];
    let pageToken = "";

    do {
      const url = new URL(`${FIRESTORE_BASE_URL}/trees`);
      url.searchParams.set("key", FIREBASE_API_KEY);
      url.searchParams.set("pageSize", "100");
      ["name", "maker", "createdAt", "updatedAt", "revision", "categoryCount", "placedWordCount"].forEach((field) => {
        url.searchParams.append("mask.fieldPaths", field);
      });
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await firebaseFetch(url);
      for (const document of response.documents || []) {
        trees.push(decodeCloudTreeDocument(document, false));
      }
      pageToken = response.nextPageToken || "";
    } while (pageToken);

    return trees.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async function getCloudTreeDocument(treeId, allowMissing = false) {
    const url = new URL(`${FIRESTORE_BASE_URL}/trees/${encodeURIComponent(treeId)}`);
    url.searchParams.set("key", FIREBASE_API_KEY);
    const document = await firebaseFetch(url, {}, allowMissing);
    return document ? decodeCloudTreeDocument(document, true) : null;
  }

  async function writeCloudTree(cloud, serializedState) {
    const url = new URL(`${FIRESTORE_BASE_URL}/trees/${encodeURIComponent(cloud.treeId)}`);
    url.searchParams.set("key", FIREBASE_API_KEY);
    await firebaseFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          name: { stringValue: cloud.name },
          maker: { stringValue: cloud.maker },
          state: { stringValue: serializedState },
          createdAt: { timestampValue: cloud.createdAt },
          updatedAt: { timestampValue: cloud.updatedAt },
          revision: { integerValue: String(cloud.revision) },
          categoryCount: { integerValue: String(countAllCategories()) },
          placedWordCount: { integerValue: String(getValidPlacements().length) }
        }
      })
    });
  }

  async function firebaseFetch(url, options = {}, allowMissing = false) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error("Geen verbinding met Firebase.");
    }

    if (allowMissing && response.status === 404) {
      return null;
    }

    if (!response.ok) {
      let message = "";
      try {
        const body = await response.json();
        message = body.error && body.error.message ? body.error.message : "";
      } catch (error) {
        message = "";
      }
      const firebaseError = new Error(message || `Firebase gaf foutcode ${response.status}.`);
      firebaseError.status = response.status;
      throw firebaseError;
    }

    return response.status === 204 ? null : response.json();
  }

  function decodeCloudTreeDocument(document, includeState) {
    const fields = document.fields;
    if (!isRecord(fields)) {
      throw new Error("Een online boom heeft geen geldige velden.");
    }

    const tree = {
      treeId: document.name.split("/").pop(),
      name: requireFirestoreString(fields, "name"),
      maker: requireFirestoreString(fields, "maker"),
      revision: requireFirestoreInteger(fields, "revision"),
      createdAt: requireFirestoreTimestamp(fields, "createdAt"),
      updatedAt: requireFirestoreTimestamp(fields, "updatedAt"),
      categoryCount: requireFirestoreInteger(fields, "categoryCount"),
      placedWordCount: requireFirestoreInteger(fields, "placedWordCount")
    };
    if (tree.revision < 1 || tree.categoryCount < 0 || tree.placedWordCount < 0) {
      throw new Error("Een online boom bevat ongeldige aantallen.");
    }

    if (includeState) {
      tree.serializedState = requireFirestoreString(fields, "state");
    }

    return tree;
  }

  function countAllCategories() {
    return state.roots.reduce((total, root) => total + countNodes(root), 0);
  }

  function formatCloudDate(value) {
    return new Intl.DateTimeFormat("nl-NL", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function setCloudStatus(message, isError = false) {
    cloudStatus.textContent = message;
    cloudStatus.classList.toggle("is-error", isError);
  }

  function setCloudBusy(isBusy) {
    saveCloudTreeButton.disabled = isBusy;
    cloudTreeNameInput.disabled = isBusy;
    cloudTreeMakerInput.disabled = isBusy;
    cloudTreeList.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  function firebaseErrorMessage(error, fallback) {
    if (error.status === 403) {
      return "Firebase weigert toegang. Controleer of de Firestore-regels zijn gepubliceerd.";
    }
    if (error.status === 404) {
      return "De gekozen boom bestaat niet meer.";
    }
    return error.message || fallback;
  }

  function loadPreferredMaker() {
    try {
      return cleanMakerName(localStorage.getItem(MAKER_STORAGE_KEY) || "");
    } catch (error) {
      return "";
    }
  }

  function savePreferredMaker(maker) {
    try {
      localStorage.setItem(MAKER_STORAGE_KEY, cleanMakerName(maker));
    } catch (error) {
      // De boom kan nog steeds worden opgeslagen als lokale voorkeuren niet beschikbaar zijn.
    }
  }

  function createId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : `tree-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function hasSavedWork() {
    return state.roots.length > 0 ||
      state.placements.length > 0 ||
      state.customWords.length > 0 ||
      state.hiddenWords.length > 0;
  }

  function scheduleViewSave() {
    window.clearTimeout(viewSaveTimer);
    viewSaveTimer = window.setTimeout(saveState, 150);
  }

  function syncViewState() {
    state.view = {
      mode,
      scrollLeft: workspace.scrollLeft,
      scrollTop: workspace.scrollTop
    };
  }

  function restoreViewState() {
    const savedView = { ...state.view };
    window.requestAnimationFrame(() => {
      workspace.scrollLeft = savedView.scrollLeft;
      workspace.scrollTop = savedView.scrollTop;
    });
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
