let reviewRequested = false;
const commandMenu = $('[data-command-menu]');
const commandPrompt = $('[data-task-prompt]');
let commandItems = [];
let commandIndex = 0;

function collaborationMode() {
  return currentThread()?.collaborationMode === 'plan' ? 'plan' : 'default';
}

function renderCollaborationMode() {
  const button = $('[data-collaboration-mode]');
  const plan = collaborationMode() === 'plan';
  button.hidden = !plan;
  button.textContent = '计划模式';
  button.setAttribute('aria-label', '计划模式已开启，点击切换模式');
}

function closeCommandMenu({ restore = false } = {}) {
  commandMenu.hidden = true;
  commandMenu.replaceChildren();
  commandPrompt.setAttribute('aria-expanded', 'false');
  commandItems = [];
  commandIndex = 0;
  if (restore) commandPrompt.focus();
}

function paintCommandSelection() {
  commandItems.forEach((item, index) => {
    item.button.setAttribute('aria-selected', String(index === commandIndex));
    item.button.tabIndex = index === commandIndex ? 0 : -1;
  });
}

function showCommandItems(items) {
  commandItems = items;
  commandIndex = Math.min(commandIndex, Math.max(0, items.length - 1));
  commandMenu.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    const command = document.createElement('strong'); command.textContent = item.command;
    const description = document.createElement('span'); description.textContent = item.description;
    button.append(command, description);
    button.onclick = () => item.run();
    item.button = button; commandMenu.append(button);
  }
  commandMenu.hidden = !items.length;
  commandPrompt.setAttribute('aria-expanded', String(Boolean(items.length)));
  paintCommandSelection();
}

async function setConversationMode(mode) {
  if (submitting || ui.runningThread) return setMessage('请先停止当前任务再切换模式。', true);
  if (!ui.projectPath) { await chooseProject(); if (!ui.projectPath) return; }
  if (!ui.threadId) await newThread(ui.projectPath);
  ui.history = await window.botgo.setThreadMode(ui.threadId, mode);
  commandPrompt.value = '';
  closeCommandMenu(); render(); commandPrompt.focus();
  setMessage(mode === 'plan' ? '已为当前对话开启计划模式。' : '当前对话已切回默认模式。');
}

function showPlanChoices() {
  showCommandItems([
    { command: '计划模式', description: '先分析并形成计划，不直接实施改动', run: () => setConversationMode('plan').catch(error => setMessage(error.message, true)) },
    { command: '默认模式', description: '恢复当前对话的普通执行模式', run: () => setConversationMode('default').catch(error => setMessage(error.message, true)) }
  ]);
}

function showCommands(query = '') {
  const commands = [
    { command: '/plan', description: '选择当前对话的协作模式', run: showPlanChoices },
    { command: '/review', description: '审阅当前目录中的未提交改动', run: () => {
      if (ui.runningThread) return setMessage('请先停止当前任务。', true);
      reviewRequested = true; commandPrompt.value = '审阅当前项目的未提交改动'; closeCommandMenu(); syncControls(); commandPrompt.focus();
    } },
    { command: '/new', description: '在当前目录中开始新对话', run: () => { closeCommandMenu(); newThread().catch(error => setMessage(error.message, true)); } }
  ];
  const needle = query.toLowerCase();
  showCommandItems(commands.filter(item => item.command.startsWith(needle)));
}

function updateCommandMenu() {
  const value = commandPrompt.value.trimStart();
  if (reviewRequested && value !== '审阅当前项目的未提交改动') reviewRequested = false;
  if (!value.startsWith('/') || /\s/.test(value)) return closeCommandMenu();
  showCommands(value.toLowerCase());
}

commandPrompt.addEventListener('input', updateCommandMenu);
commandPrompt.addEventListener('keydown', event => {
  if (commandMenu.hidden) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeCommandMenu(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); event.stopImmediatePropagation();
    commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + commandItems.length) % commandItems.length;
    paintCommandSelection(); return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); event.stopImmediatePropagation(); commandItems[commandIndex]?.run();
  }
}, true);
document.addEventListener('pointerdown', event => { if (!event.target.closest('[data-command-menu],[data-task-prompt],[data-collaboration-mode]')) closeCommandMenu(); });
$('[data-collaboration-mode]').onclick = () => { commandPrompt.value = '/plan'; showPlanChoices(); commandPrompt.focus(); };
