const $ = (id) => document.getElementById(id);
let page = 1,
  search = "",
  loading = false;
const limit = 20;
let pageItems = [];
const selected = new Map();
let loadVersion = 0;

function selectionChanged() {
  const count = selected.size;
  $("selected-count").textContent = `${count} selected`;
  $("select-all").checked = pageItems.length > 0 && count === pageItems.length;
  $("select-all").indeterminate = count > 0 && count < pageItems.length;
  $("select-all").disabled = loading || !pageItems.length;
  $("copy-selected").disabled = $("delete-selected").disabled =
    loading || !count;
}

function notice(text = "") {
  for (const id of ["notice", "login-error"]) {
    $(id).textContent = text;
    $(id).hidden = !text;
  }
}

function signedIn(value) {
  $("login-panel").hidden = value;
  $("workspace").hidden = !value;
  if (!value) {
    loadVersion++;
    loading = false;
    page = 1;
    search = "";
    $("search").value = "";
    selected.clear();
    pageItems = [];
    selectionChanged();
    $("links").replaceChildren();
    $("create-form").reset();
    $("result").hidden = true;
    $("result-link").textContent = "";
    $("result-link").removeAttribute("href");
  }
}

async function request(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 401) signedIn(false);
    throw new Error(await response.text());
  }
  return response.status === 204 ? null : response.json();
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    notice(error.message || "Request failed.");
  }
}

function form(id, action) {
  $(id).addEventListener("submit", (event) => {
    event.preventDefault();
    if ($(id).inert) return;
    $(id).inert = true;
    run(action).finally(() => {
      $(id).inert = false;
    });
  });
}

async function copy(text) {
  await run(async () => {
    if (!navigator.clipboard) throw new Error("Select the link to copy it.");
    await navigator.clipboard.writeText(text);
    notice("Copied.");
  });
}

async function load() {
  const version = ++loadVersion;
  loading = true;
  selectionChanged();
  $("previous").disabled = $("next").disabled = true;
  try {
    const data = await request(
      `/api/links?${new URLSearchParams({ page, limit, q: search })}`,
    );
    if (version !== loadVersion) return;
    const lastPage = Math.max(1, Math.ceil(data.total / limit));
    if (page > lastPage) { page = lastPage; return load(); }
    selected.clear();
    pageItems = data.items;
    $("links").replaceChildren();
    if (!data.items.length) $("links").textContent = "No links.";
    for (const item of data.items) {
      const row = $("link-row").content.cloneNode(true);
      const link = row.querySelector("[data-link]");
      link.textContent = `/${item.path}`;
      link.href = `/${encodeURIComponent(item.path)}`;
      row.querySelector("[data-url]").textContent = item.url;
      row.querySelector("[data-copy]").onclick = () => copy(item.shortLink);
      const checkbox = row.querySelector("[data-select]");
      checkbox.setAttribute("aria-label", `Select /${item.path}`);
      checkbox.dataset.path = item.path;
      checkbox.onchange = () => {
        if (checkbox.checked) selected.set(item.path, item);
        else selected.delete(item.path);
        selectionChanged();
      };
      const remove = row.querySelector("[data-delete]");
      remove.onclick = () => {
        if (!confirm(`Delete /${item.path}?`)) return;
        remove.disabled = true;
        run(async () => {
          await request(
            `/api/links/${encodeURIComponent(item.path)}`,
            "DELETE",
          );
          if ($("result-link").textContent === item.shortLink)
            $("result").hidden = true;
          if (data.items.length === 1 && page > 1) page--;
          notice("Deleted.");
          await load();
        }).finally(() => {
          remove.disabled = false;
        });
      };
      $("links").append(row);
    }
    $("page").textContent =
      `${page} / ${Math.max(1, Math.ceil(data.total / limit))}`;
    $("previous").disabled = page <= 1;
    $("next").disabled = page * limit >= data.total;
  } finally {
    if (version === loadVersion) {
      loading = false;
      selectionChanged();
    }
  }
}

$("select-all").onchange = () => {
  selected.clear();
  if ($("select-all").checked)
    for (const item of pageItems) selected.set(item.path, item);
  for (const checkbox of $("links").querySelectorAll("[data-select]"))
    checkbox.checked = selected.has(checkbox.dataset.path);
  selectionChanged();
};
$("copy-selected").onclick = () =>
  copy([...selected.values()].map((item) => item.shortLink).join("\n"));
$("delete-selected").onclick = () => {
  const items = [...selected.values()];
  if (
    !items.length ||
    !confirm(`Delete ${items.length} selected links? This cannot be undone.`)
  )
    return;
  $("workspace").inert = true;
  run(async () => {
    const data = await request("/api/links/delete", "POST", {
      paths: items.map((item) => item.path),
    });
    if (items.some((item) => item.shortLink === $("result-link").textContent))
      $("result").hidden = true;
    if (items.length === pageItems.length && page > 1) page--;
    notice(`Deleted ${data.deleted} links.`);
    await load();
  }).finally(() => {
    $("workspace").inert = false;
  });
};

form("login-form", async () => {
  try {
    await request("/api/auth", "POST", { key: $("key").value });
  } finally {
    $("key").value = "";
  }
  signedIn(true);
  notice();
  await load();
});
form("create-form", async () => {
  const path = $("path").value.trim();
  const data = await request("/", "POST", {
    url: $("url").value.trim(),
    ...(path ? { path } : {}),
  });
  $("result-link").textContent = $("result-link").href = data.shortLink;
  $("result").hidden = false;
  $("create-form").reset();
  page = 1;
  search = "";
  $("search").value = "";
  notice();
  await load();
});
form("search-form", async () => {
  if (loading) return;
  search = $("search").value.trim();
  page = 1;
  await load();
});
$("copy-result").onclick = () => copy($("result-link").href);
$("logout").onclick = () =>
  run(async () => {
    await request("/api/auth", "DELETE");
    signedIn(false);
    notice();
  });
for (const [id, step] of [
  ["previous", -1],
  ["next", 1],
]) {
  $(id).onclick = () => {
    if (!loading) {
      page += step;
      run(load);
    }
  };
}
run(async () => {
  const response = await fetch("/api/auth", { credentials: "same-origin" });
  if (response.status === 401) return;
  if (!response.ok) throw new Error(await response.text());
  signedIn(true);
  await load();
});
