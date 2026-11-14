const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');

async function getManaged() {
  const self = await chrome.management.getSelf();
  const all = await chrome.management.getAll();
  return all.filter(e => e.type === 'extension' && e.id !== self.id);
}

async function render() {
  listEl.textContent = '';
  const { snapshot } = await chrome.storage.local.get('snapshot');
  const live = (await getManaged()).sort((a, b) => a.name.localeCompare(b.name));
  const liveIds = new Set(live.map(e => e.id));
  const saved = new Set((snapshot || []).filter(e => e.enabled).map(e => e.id));

  statusEl.textContent = snapshot
    ? `Snapshot saved (${saved.size} were enabled, listed first). Tick an extension to enable it, untick to disable.`
    : 'Untick an extension to disable it, tick to enable.';

  // With a snapshot, the extensions it saved as enabled come first.
  const rows = [
    ...live.filter(e => saved.has(e.id)),
    ...live.filter(e => !saved.has(e.id)),
  ].map(e => ({ id: e.id, name: e.name, ext: e }));
  for (const snap of snapshot || []) {
    if (snap.enabled && !liveIds.has(snap.id)) rows.push({ id: snap.id, name: snap.name, ext: null });
  }

  for (const item of rows) {
    const row = document.createElement('div');
    row.className = 'row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'cb-' + item.id;

    const label = document.createElement('label');
    label.htmlFor = box.id;
    label.textContent = item.name;

    if (!item.ext) {
      box.disabled = true;
      label.textContent += ' (no longer installed)';
      row.classList.add('gone');
    } else {
      box.checked = item.ext.enabled;
      // Extensions installed by policy can't be turned off.
      if (item.ext.enabled && !item.ext.mayDisable) box.disabled = true;
      box.addEventListener('change', async () => {
        try {
          await chrome.management.setEnabled(item.id, box.checked);
        } catch (err) {
          box.checked = !box.checked;
          statusEl.textContent = `Could not change ${item.name}.`;
        }
      });
    }
    row.append(box, label);
    listEl.appendChild(row);
  }
}

document.getElementById('save').addEventListener('click', async () => {
  const { snapshot: existing } = await chrome.storage.local.get('snapshot');
  if (existing) {
    statusEl.textContent = 'A snapshot is already saved. Restore it first so the original state is not overwritten.';
    return;
  }
  const list = await getManaged();
  const snapshot = list.map(e => ({ id: e.id, name: e.name, enabled: e.enabled }));
  await chrome.storage.local.set({ snapshot });

  const failed = [];
  for (const e of list) {
    if (!e.enabled) continue;
    try {
      await chrome.management.setEnabled(e.id, false);
    } catch (err) {
      failed.push(e.name);
    }
  }
  await render();
  if (failed.length) {
    statusEl.textContent += `\nCould not disable: ${failed.join(', ')}`;
  }
});

document.getElementById('restore').addEventListener('click', async () => {
  const { snapshot } = await chrome.storage.local.get('snapshot');
  if (!snapshot) {
    statusEl.textContent = 'No saved snapshot.';
    return;
  }
  const failed = [];
  for (const e of snapshot) {
    if (!e.enabled) continue;
    try {
      await chrome.management.setEnabled(e.id, true);
    } catch (err) {
      failed.push(e.name);
    }
  }
  await chrome.storage.local.remove('snapshot');
  await render();
  statusEl.textContent = failed.length
    ? `Restored. Could not re-enable (removed or blocked): ${failed.join(', ')}`
    : 'All saved extensions re-enabled. Snapshot cleared.';
});

document.getElementById('reset').addEventListener('click', async () => {
  const { snapshot } = await chrome.storage.local.get('snapshot');
  if (!snapshot) {
    statusEl.textContent = 'No saved snapshot.';
    return;
  }
  await chrome.storage.local.remove('snapshot');
  await render();
  statusEl.textContent = 'Saved state discarded. Extensions left as they are now.';
});

render();
