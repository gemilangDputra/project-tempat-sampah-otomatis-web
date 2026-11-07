import { GoogleSheetsAPI } from "./api.js";
import { CSVParser } from "./csv.js";
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

/* ==========================================================================
   Konfigurasi
   ========================================================================== */

const CONFIG = {
    cacheKey: "ruang-kerja:anggota:v1",
    cacheTtlMs: 5 * 60 * 1000,
    fetchRetries: 3,
    retryBaseDelayMs: 600,
    pageSize: 10,
    undefinedTask: "Tidak ditentukan",
    codeUrl:
        "https://raw.githubusercontent.com/gemilangDputra/project-tempat-sampah-otomatis-web/main/asset/arduinoCode.ino",
    codeFileName: "arduinoCode.ino",
    pdfMinScale: 0.5,
    pdfMaxScale: 3,
    pdfScaleStep: 0.25
};

/* ==========================================================================
   Utilitas
   ========================================================================== */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function storageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function storageSet(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        /* penyimpanan penuh atau diblokir: abaikan */
    }
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function maskEmail(email) {
    const value = String(email || "").trim();
    const at = value.indexOf("@");
    if (at < 1) return value ? "•••" : "–";
    return `${value[0]}•••${value.slice(at)}`;
}

function parseTimestamp(raw) {
    const text = String(raw || "").trim();
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);

    if (match) {
        let day = Number(match[1]);
        let month = Number(match[2]);
        if (month > 12 && day <= 12) [day, month] = [month, day];

        const time = new Date(
            Number(match[3]),
            month - 1,
            day,
            Number(match[4]) || 0,
            Number(match[5]) || 0,
            Number(match[6]) || 0
        ).getTime();

        if (!Number.isNaN(time)) return time;
    }

    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function formatRelative(ms) {
    const diff = Date.now() - ms;
    const minute = 60 * 1000;
    const hour = 60 * minute;

    if (diff < minute) return "Baru saja";
    if (diff < hour) return `${Math.floor(diff / minute)} menit lalu`;
    if (diff < 24 * hour) return `${Math.floor(diff / hour)} jam lalu`;

    return new Date(ms).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

/* ---------- Toast ---------- */

let toastTimer = null;

function showToast(message, type = "info") {
    const toast = $("#toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.toggle("is-error", type === "error");
    toast.hidden = false;

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 2800);
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();

        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch {
            ok = false;
        }

        area.remove();
        return ok;
    }
}

/* ==========================================================================
   Data anggota
   ========================================================================== */

const memberState = {
    all: [],
    filtered: [],
    visibleCount: CONFIG.pageSize,
    showEmail: false,
    lastUpdated: 0,
    query: "",
    task: "",
    sort: "newest"
};

const memberUi = {
    body: $("#members-table-body"),
    count: $("#member-count"),
    search: $("#search-member"),
    filter: $("#filter-tugas"),
    sort: $("#sort-member"),
    toggleEmail: $("#toggle-email"),
    refresh: $("#refresh-members"),
    showMore: $("#show-more"),
    statMembers: $("#stat-members"),
    statTasks: $("#stat-tasks"),
    statUpdated: $("#stat-updated"),
    chart: $("#task-chart")
};

function readCache() {
    const raw = storageGet(CONFIG.cacheKey);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.csv === "string" && typeof parsed.time === "number") return parsed;
    } catch {
        /* cache rusak: abaikan */
    }
    return null;
}

function writeCache(csv) {
    if (typeof csv !== "string") return;
    storageSet(CONFIG.cacheKey, JSON.stringify({ csv, time: Date.now() }));
}

async function fetchCsvWithRetry() {
    let lastError = null;

    for (let attempt = 0; attempt < CONFIG.fetchRetries; attempt++) {
        try {
            return await GoogleSheetsAPI.getCSV();
        } catch (error) {
            lastError = error;
            if (attempt < CONFIG.fetchRetries - 1) {
                await sleep(CONFIG.retryBaseDelayMs * 2 ** attempt);
            }
        }
    }

    throw lastError;
}

function normalizeMember(row) {
    const tugas = String(row.tugas || "").trim() || CONFIG.undefinedTask;

    return {
        timestamp: String(row.timestamp || "").trim(),
        email: String(row.email || "").trim(),
        nama: String(row.nama || "").trim(),
        tugas,
        time: parseTimestamp(row.timestamp)
    };
}

function renderSkeleton() {
    memberUi.body.replaceChildren();

    for (let i = 0; i < 4; i++) {
        const tr = el("tr", "skeleton-row");
        for (let j = 0; j < 4; j++) {
            const td = el("td");
            const bar = el("span", "skeleton");
            bar.style.width = `${55 + ((i + j) % 3) * 15}%`;
            td.appendChild(bar);
            tr.appendChild(td);
        }
        memberUi.body.appendChild(tr);
    }

    memberUi.count.textContent = "Memuat data anggota...";
}

function renderMessageRow(message, { error = false, retry = false } = {}) {
    memberUi.body.replaceChildren();

    const tr = el("tr", error ? "table-message is-error" : "table-message");
    const td = el("td", "", message);
    td.colSpan = 4;

    if (retry) {
        const button = el("button", "btn btn-ghost", "Coba lagi");
        button.type = "button";
        button.addEventListener("click", () => loadMembers({ force: true }));
        td.appendChild(button);
    }

    tr.appendChild(td);
    memberUi.body.appendChild(tr);
}

function renderTable() {
    const { filtered, visibleCount, showEmail } = memberState;

    if (filtered.length === 0) {
        const hasFilter = memberState.query || memberState.task;
        renderMessageRow(
            hasFilter
                ? "Tidak ada anggota yang cocok dengan pencarian."
                : "Belum ada anggota yang terdaftar."
        );
        memberUi.count.textContent = "Menampilkan 0 anggota";
        memberUi.showMore.hidden = true;
        return;
    }

    const visible = filtered.slice(0, visibleCount);
    const fragment = document.createDocumentFragment();

    visible.forEach((member) => {
        const tr = el("tr");

        tr.appendChild(el("td", "cell-time", member.timestamp || "–"));
        tr.appendChild(el("td", "cell-email", showEmail ? member.email || "–" : maskEmail(member.email)));
        tr.appendChild(el("td", "cell-name", member.nama || "–"));

        const taskCell = el("td");
        const isUndefined = member.tugas === CONFIG.undefinedTask;
        taskCell.appendChild(el("span", isUndefined ? "tag tag-muted" : "tag", member.tugas));
        tr.appendChild(taskCell);

        fragment.appendChild(tr);
    });

    memberUi.body.replaceChildren(fragment);

    const total = memberState.all.length;
    memberUi.count.textContent =
        filtered.length === total
            ? `Menampilkan ${visible.length} dari ${total} anggota`
            : `Menampilkan ${visible.length} dari ${filtered.length} hasil (total ${total} anggota)`;

    const remaining = filtered.length - visible.length;
    memberUi.showMore.hidden = remaining <= 0;
    if (remaining > 0) {
        memberUi.showMore.textContent = `Tampilkan ${Math.min(remaining, CONFIG.pageSize)} lagi`;
    }
}

function applyFilters({ resetPaging = true } = {}) {
    const query = memberState.query.trim().toLowerCase();

    let result = memberState.all.filter((member) => {
        if (memberState.task && member.tugas !== memberState.task) return false;
        if (!query) return true;

        return (
            member.nama.toLowerCase().includes(query) ||
            member.email.toLowerCase().includes(query) ||
            member.tugas.toLowerCase().includes(query)
        );
    });

    const collator = new Intl.Collator("id", { sensitivity: "base" });

    switch (memberState.sort) {
        case "oldest":
            result = result.sort((a, b) => a.time - b.time);
            break;
        case "name":
            result = result.sort((a, b) => collator.compare(a.nama, b.nama));
            break;
        case "task":
            result = result.sort(
                (a, b) => collator.compare(a.tugas, b.tugas) || collator.compare(a.nama, b.nama)
            );
            break;
        default:
            result = result.sort((a, b) => b.time - a.time);
    }

    memberState.filtered = result;
    if (resetPaging) memberState.visibleCount = CONFIG.pageSize;
    renderTable();
}

function populateTaskFilter() {
    const previous = memberUi.filter.value;
    const tasks = [...new Set(memberState.all.map((member) => member.tugas))]
        .filter((task) => task && task !== CONFIG.undefinedTask)
        .sort((a, b) => a.localeCompare(b, "id"));

    memberUi.filter.replaceChildren(new Option("Semua Tugas", ""));
    tasks.forEach((task) => memberUi.filter.appendChild(new Option(task, task)));

    if (tasks.includes(previous)) {
        memberUi.filter.value = previous;
    } else {
        memberUi.filter.value = "";
        memberState.task = "";
    }
}

function updateStats() {
    const total = memberState.all.length;
    const taskCount = new Set(
        memberState.all.map((member) => member.tugas).filter((task) => task !== CONFIG.undefinedTask)
    ).size;

    memberUi.statMembers.textContent = String(total);
    memberUi.statTasks.textContent = String(taskCount);
    updateUpdatedLabel();
}

function updateUpdatedLabel() {
    memberUi.statUpdated.textContent = memberState.lastUpdated
        ? formatRelative(memberState.lastUpdated)
        : "–";
}

function renderTaskChart() {
    const container = memberUi.chart;
    const counts = new Map();

    memberState.all.forEach((member) => {
        counts.set(member.tugas, (counts.get(member.tugas) || 0) + 1);
    });

    if (counts.size === 0) {
        container.replaceChildren(el("p", "chart-empty", "Belum ada data tugas untuk ditampilkan."));
        return;
    }

    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id"));
    const max = rows[0][1];
    const total = memberState.all.length;
    const fragment = document.createDocumentFragment();
    const fills = [];

    rows.forEach(([task, count]) => {
        const row = el("div", "bar-row");
        const track = el("div", "bar-track");
        const fill = el("span", "bar-fill");
        const percent = Math.round((count / total) * 100);

        track.setAttribute("role", "img");
        track.setAttribute("aria-label", `${task}: ${count} anggota (${percent}%)`);

        if (task === CONFIG.undefinedTask) fill.style.background = "var(--line-strong)";

        track.appendChild(fill);
        fills.push([fill, (count / max) * 100]);

        row.appendChild(el("span", "bar-label", task));
        row.appendChild(track);
        row.appendChild(el("span", "bar-value", `${count} · ${percent}%`));
        fragment.appendChild(row);
    });

    fragment.appendChild(el("p", "chart-note", `Total ${total} anggota terdaftar.`));
    container.replaceChildren(fragment);

    requestAnimationFrame(() => {
        fills.forEach(([fill, width]) => {
            fill.style.width = `${width}%`;
        });
    });
}

function applyMemberData(csv, time) {
    const parsed = CSVParser.parse(csv);
    memberState.all = Array.isArray(parsed) ? parsed.map(normalizeMember) : [];
    memberState.lastUpdated = time;

    populateTaskFilter();
    updateStats();
    renderTaskChart();
    applyFilters();
}

async function loadMembers({ force = false } = {}) {
    const cached = readCache();
    const isFresh = cached && Date.now() - cached.time < CONFIG.cacheTtlMs;

    if (cached && isFresh && !force) {
        applyMemberData(cached.csv, cached.time);
        return;
    }

    memberUi.refresh.classList.add("is-spinning");
    memberUi.refresh.disabled = true;

    if (cached) {
        applyMemberData(cached.csv, cached.time);
    } else {
        renderSkeleton();
    }

    try {
        const csv = await fetchCsvWithRetry();
        writeCache(csv);
        applyMemberData(csv, Date.now());
        if (force) showToast("Data anggota diperbarui");
    } catch (error) {
        console.error("Gagal memuat data anggota:", error);

        if (cached) {
            showToast("Gagal memuat data terbaru. Menampilkan data tersimpan.", "error");
        } else {
            renderMessageRow("Gagal mengambil data dari server.", { error: true, retry: true });
            memberUi.count.textContent = "Gagal memuat data";
            memberUi.statMembers.textContent = "–";
            memberUi.statTasks.textContent = "–";
            memberUi.chart.replaceChildren(
                el("p", "chart-empty", "Data tugas belum bisa ditampilkan.")
            );
        }
    } finally {
        memberUi.refresh.classList.remove("is-spinning");
        memberUi.refresh.disabled = false;
    }
}

function initMembers() {
    memberUi.search.addEventListener(
        "input",
        debounce((event) => {
            memberState.query = event.target.value;
            applyFilters();
        }, 150)
    );

    memberUi.filter.addEventListener("change", (event) => {
        memberState.task = event.target.value;
        applyFilters();
    });

    memberUi.sort.addEventListener("change", (event) => {
        memberState.sort = event.target.value;
        applyFilters();
    });

    memberUi.showMore.addEventListener("click", () => {
        memberState.visibleCount += CONFIG.pageSize;
        renderTable();
    });

    memberUi.toggleEmail.addEventListener("click", () => {
        memberState.showEmail = !memberState.showEmail;

        const button = memberUi.toggleEmail;
        button.setAttribute("aria-pressed", String(memberState.showEmail));
        $(".material-symbols-outlined", button).textContent = memberState.showEmail
            ? "visibility_off"
            : "visibility";
        $("span:last-child", button).textContent = memberState.showEmail
            ? "Sembunyikan email"
            : "Tampilkan email";

        renderTable();
    });

    memberUi.refresh.addEventListener("click", () => loadMembers({ force: true }));

    setInterval(updateUpdatedLabel, 30 * 1000);

    return loadMembers();
}

/* ==========================================================================
   Source code Arduino
   ========================================================================== */

async function initCodeSpace() {
    const codeElement = $("#code-preview");
    const copyButton = $("#copy-code");
    const downloadButton = $("#download-code");
    const statusLabel = $("#code-status");
    const metaLabel = $("#code-meta");
    let sourceCode = "";

    copyButton.addEventListener("click", async () => {
        if (!sourceCode) return;

        const label = $(".btn-label", copyButton);
        const ok = await copyText(sourceCode);

        if (ok) {
            label.textContent = "Copied!";
            showToast("Source code disalin ke clipboard");
            setTimeout(() => {
                label.textContent = "Copy Code";
            }, 2000);
        } else {
            showToast("Gagal menyalin kode. Salin manual dari kotak kode.", "error");
        }
    });

    downloadButton.addEventListener("click", () => {
        if (!sourceCode) return;

        const blob = new Blob([sourceCode], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = CONFIG.codeFileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    try {
        const response = await fetch(CONFIG.codeUrl);
        if (!response.ok) throw new Error(`Status ${response.status}`);

        sourceCode = await response.text();
        codeElement.textContent = sourceCode;

        if (window.Prism) window.Prism.highlightElement(codeElement);

        const lines = sourceCode.split("\n").length;
        metaLabel.textContent = `${lines} baris · ${formatBytes(new Blob([sourceCode]).size)}`;
        statusLabel.textContent = "Source code berhasil dimuat.";
        copyButton.disabled = false;
        downloadButton.disabled = false;
    } catch (error) {
        console.error("Gagal memuat source code:", error);
        codeElement.textContent = "Gagal memuat source code.";
        statusLabel.textContent = "Gagal terhubung ke GitHub.";
    }
}

/* ==========================================================================
   PDF viewer (dimuat saat terlihat)
   ========================================================================== */

const pdfDocuments = new Map();

function loadPdfDocument(url) {
    if (!pdfDocuments.has(url)) {
        const promise = pdfjsLib.getDocument(url).promise;
        promise.catch(() => pdfDocuments.delete(url));
        pdfDocuments.set(url, promise);
    }
    return pdfDocuments.get(url);
}

function createPdfViewer(viewer) {
    const url = viewer.dataset.src;
    const canvas = $(".pdf-canvas", viewer);
    const context = canvas.getContext("2d");
    const container = $(".pdf-canvas-container", viewer);

    const pageInfo = $(".pdf-page-info", viewer);
    const zoomInfo = $(".pdf-zoom-info", viewer);
    const status = $(".pdf-status", viewer);

    const prevButton = $(".pdf-prev", viewer);
    const nextButton = $(".pdf-next", viewer);
    const zoomInButton = $(".pdf-zoom-in", viewer);
    const zoomOutButton = $(".pdf-zoom-out", viewer);
    const fitButton = $(".pdf-fit", viewer);

    let pdf = null;
    let currentPage = 1;
    let scale = 1;
    let renderTask = null;
    let renderToken = 0;
    let lastWidth = 0;
    let started = false;

    function setStatus(message, { error = false, retry = false } = {}) {
        status.classList.toggle("is-error", error);
        status.textContent = message;

        if (retry) {
            const button = el("button", "", "Coba lagi");
            button.type = "button";
            button.addEventListener("click", () => {
                started = false;
                start();
            });
            status.appendChild(button);
        }
    }

    function updateControls() {
        const ready = Boolean(pdf);
        prevButton.disabled = !ready || currentPage <= 1;
        nextButton.disabled = !ready || currentPage >= pdf.numPages;
        zoomOutButton.disabled = !ready || scale <= CONFIG.pdfMinScale;
        zoomInButton.disabled = !ready || scale >= CONFIG.pdfMaxScale;
        fitButton.disabled = !ready || scale === 1;

        pageInfo.textContent = ready ? `${currentPage} / ${pdf.numPages}` : "Memuat PDF...";
        zoomInfo.textContent = `${Math.round(scale * 100)}%`;
    }

    async function renderPage() {
        if (!pdf) return;

        const token = ++renderToken;

        if (renderTask) {
            renderTask.cancel();
            renderTask = null;
        }

        try {
            const page = await pdf.getPage(currentPage);
            if (token !== renderToken) return;

            const style = getComputedStyle(container);
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const available = Math.max(container.clientWidth - padding, 160);

            const baseViewport = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: (available / baseViewport.width) * scale });
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

            canvas.width = Math.floor(viewport.width * pixelRatio);
            canvas.height = Math.floor(viewport.height * pixelRatio);
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;

            renderTask = page.render({
                canvasContext: context,
                viewport,
                transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null
            });

            await renderTask.promise;
            if (token !== renderToken) return;

            lastWidth = container.clientWidth;
            updateControls();
            setStatus("Dokumen berhasil dimuat.");
        } catch (error) {
            if (error && error.name === "RenderingCancelledException") return;
            console.error("Gagal merender PDF:", error);
            setStatus("Gagal menampilkan halaman ini.", { error: true });
        }
    }

    function goToPage(page) {
        if (!pdf) return;
        const next = Math.min(Math.max(page, 1), pdf.numPages);
        if (next === currentPage) return;

        currentPage = next;
        container.scrollTo({ top: 0 });
        updateControls();
        renderPage();
    }

    function setScale(next) {
        const clamped = Math.min(Math.max(next, CONFIG.pdfMinScale), CONFIG.pdfMaxScale);
        if (clamped === scale) return;

        scale = clamped;
        updateControls();
        renderPage();
    }

    prevButton.addEventListener("click", () => goToPage(currentPage - 1));
    nextButton.addEventListener("click", () => goToPage(currentPage + 1));
    zoomInButton.addEventListener("click", () => setScale(scale + CONFIG.pdfScaleStep));
    zoomOutButton.addEventListener("click", () => setScale(scale - CONFIG.pdfScaleStep));
    fitButton.addEventListener("click", () => setScale(1));

    container.addEventListener("keydown", (event) => {
        if (!pdf) return;

        if (event.key === "ArrowRight" || event.key === "PageDown") {
            event.preventDefault();
            goToPage(currentPage + 1);
        } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
            event.preventDefault();
            goToPage(currentPage - 1);
        } else if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            setScale(scale + CONFIG.pdfScaleStep);
        } else if (event.key === "-") {
            event.preventDefault();
            setScale(scale - CONFIG.pdfScaleStep);
        }
    });

    if ("ResizeObserver" in window) {
        const onResize = debounce(() => {
            if (pdf && Math.abs(container.clientWidth - lastWidth) > 4) renderPage();
        }, 150);
        new ResizeObserver(onResize).observe(container);
    }

    async function start() {
        if (started) return;
        started = true;

        setStatus("Memuat dokumen...");
        updateControls();

        try {
            pdf = await loadPdfDocument(url);
            currentPage = 1;
            updateControls();
            await renderPage();
        } catch (error) {
            console.error("Gagal memuat PDF:", error);
            pdf = null;
            pageInfo.textContent = "Tidak tersedia";
            setStatus("Gagal memuat dokumen PDF.", { error: true, retry: true });
        }
    }

    return { start };
}

function initPdfViewers() {
    const viewers = $$(".pdf-viewer").map((viewer) => ({
        node: viewer,
        controller: createPdfViewer(viewer)
    }));

    if (!("IntersectionObserver" in window)) {
        viewers.forEach(({ controller }) => controller.start());
        return;
    }

    const byNode = new Map(viewers.map((item) => [item.node, item.controller]));

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                observer.unobserve(entry.target);
                byNode.get(entry.target)?.start();
            });
        },
        { rootMargin: "300px 0px" }
    );

    viewers.forEach(({ node }) => observer.observe(node));
}

/* ==========================================================================
   Navigasi: tandai bagian yang sedang dilihat
   ========================================================================== */

// Geser hanya menu navigasi secara horizontal. Jangan pakai scrollIntoView di sini:
// itu ikut menggulir halaman secara vertikal dan terasa seperti "melawan" scroll pengguna.
function centerNavLink(link) {
    const nav = link.parentElement;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;

    const navRect = nav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const target =
        nav.scrollLeft + (linkRect.left - navRect.left) - (nav.clientWidth - linkRect.width) / 2;

    nav.scrollTo({ left: Math.max(target, 0), behavior: "smooth" });
}

function initNavHighlight() {
    const links = $$(".topnav a[data-section]");
    const sections = links
        .map((link) => document.getElementById(link.dataset.section))
        .filter(Boolean);

    if (!sections.length || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;

                links.forEach((link) => {
                    const active = link.dataset.section === entry.target.id;
                    link.classList.toggle("is-active", active);
                    if (active) {
                        link.setAttribute("aria-current", "true");
                        centerNavLink(link);
                    } else {
                        link.removeAttribute("aria-current");
                    }
                });
            });
        },
        { rootMargin: "-35% 0px -60% 0px" }
    );

    sections.forEach((section) => observer.observe(section));
}

/* ==========================================================================
   Mulai
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
    initNavHighlight();
    initPdfViewers();
    initCodeSpace();
    initMembers();
});
