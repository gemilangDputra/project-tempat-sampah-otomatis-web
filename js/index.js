import { GoogleSheetsAPI } from "./api.js";
import { CSVParser } from "./csv.js";
import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

document.addEventListener("DOMContentLoaded", async () => {
    const tableBody = document.getElementById("members-table-body");
    const countLabel = document.getElementById("member-count");
    const filterSelect = document.getElementById("filter-tugas");
    
    let allMembers = [];
    loadArduinoCode();
    initializePdfViewers();
    
    try {
        const csvData = await GoogleSheetsAPI.getCSV();
        allMembers = CSVParser.parse(csvData);
        populateTaskFilter(allMembers, filterSelect);
        renderTable(allMembers);
        
        filterSelect.addEventListener("change", (e) => {
            const selectedTask = e.target.value;

            if (selectedTask === "") {
                renderTable(allMembers);
            } else {
                const filtered = allMembers.filter(member => member.tugas === selectedTask);
                renderTable(filtered);
            }
        });
    
    } catch (error) {
        console.error("Gagal memuat data anggota:", error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: red;">
                    Gagal mengambil data dari server.
                </td>
            </tr>
        `;
        countLabel.textContent = "Gagal memuat data";
    }
    
    function renderTable(data) {
        tableBody.innerHTML = "";
        if (data.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center;">Tidak ada data anggota yang ditemukan.</td>
                </tr>
            `;
            countLabel.textContent = "Menampilkan 0 anggota";
            return;
        }
        
        data.forEach((member) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(member.timestamp)}</td>
                <td>${escapeHtml(member.email)}</td>
                <td>${escapeHtml(member.nama)}</td>
                <td>${escapeHtml(member.tugas)}</td>
            `;
            tableBody.appendChild(tr);
        });
        countLabel.textContent = `Menampilkan ${data.length} anggota`;
    }
    
    function populateTaskFilter(data, selectElement) {
        const uniqueTasks = [...new Set(data.map(item => item.tugas))];
        
        uniqueTasks.forEach(task => {
            if (task && task !== "Tidak ditentukan") {
                const option = document.createElement("option");
                option.value = task;
                option.textContent = task;
                selectElement.appendChild(option);
            }
        });
    }
});

async function loadArduinoCode() {
    const codeElement = document.getElementById("code-preview");
    const copyButton = document.getElementById("copy-code");
    const statusLabel = document.getElementById("code-status");
    const url = "https://raw.githubusercontent.com/gemilangDputra/project-tempat-sampah-otomatis-web/main/asset/arduinoCode.ino";
    let sourceCode = "";
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error("Gagal mengambil source code.");
        }
        
        sourceCode = await response.text();
        codeElement.textContent = sourceCode;
        Prism.highlightElement(codeElement);
        
        copyButton.disabled = false;
        statusLabel.textContent = "Source code berhasil dimuat.";
    
    } catch (error) {
        console.error(error);

        codeElement.textContent = "Gagal memuat source code.";
        statusLabel.textContent = "Gagal terhubung ke GitHub.";
    }
    
    copyButton.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(sourceCode);
            
            copyButton.querySelector("span:last-child").textContent = "Copied!";
            
        } catch (error) {
            console.error("Gagal menyalin kode:", error);
            statusLabel.textContent = "Gagal menyalin kode.";
        }
    });
}

async function initializePdfViewers() {
    const pdfDocuments = [
        {
            url: "https://raw.githubusercontent.com/gemilangDputra/project-tempat-sampah-otomatis-web/main/asset/Materi%20Project%20Tempat%20Sampah%20Otomatis.pdf"
        },
        {
            url: "https://raw.githubusercontent.com/gemilangDputra/project-tempat-sampah-otomatis-web/main/asset/Panduan%20Rangkaian%20Tempat%20Sampah%20Otomatis.pdf"
        },
        {
            url: "https://raw.githubusercontent.com/gemilangDputra/project-tempat-sampah-otomatis-web/main/asset/schematic.pdf"
        }
    ];
    
    const viewers = document.querySelectorAll(".pdf-viewer");
    for (let i = 0; i < viewers.length; i++) {
        const viewer = viewers[i];
        const config = pdfDocuments[i];

        const canvas = viewer.querySelector(".pdf-canvas");
        const context = canvas.getContext("2d");

        const pageInfo = viewer.querySelector(".pdf-page-info");
        const zoomInfo = viewer.querySelector(".pdf-zoom-info");
        const status = viewer.querySelector(".pdf-status");

        const prevButton = viewer.querySelector(".pdf-prev");
        const nextButton = viewer.querySelector(".pdf-next");
        const zoomInButton = viewer.querySelector(".pdf-zoom-in");
        const zoomOutButton = viewer.querySelector(".pdf-zoom-out");

        let pdf = null;
        let currentPage = 1;
        let scale = 1;
        let renderTask = null;

        async function renderPage() {

            if (!pdf) return;

            if (renderTask) {
                renderTask.cancel();
                renderTask = null;
            }

            try {
                const page = await pdf.getPage(currentPage);
                const container = viewer.querySelector(".pdf-canvas-container");
                const baseViewport = page.getViewport({ scale: 1 });
                const fitScale = container.clientWidth / baseViewport.width;
                const viewport = page.getViewport({
                    scale: fitScale * scale
                });

                const pixelRatio = window.devicePixelRatio || 1;

                canvas.width = Math.floor(viewport.width * pixelRatio);
                canvas.height = Math.floor(viewport.height * pixelRatio);

                canvas.style.width = `${viewport.width}px`;
                canvas.style.height = `${viewport.height}px`;

                const transform = pixelRatio !== 1
                    ? [pixelRatio, 0, 0, pixelRatio, 0, 0]
                    : null;

                renderTask = page.render({
                    canvasContext: context,
                    viewport,
                    transform
                });

                await renderTask.promise;

                pageInfo.textContent =
                    `${currentPage} / ${pdf.numPages}`;

                zoomInfo.textContent =
                    `${Math.round(scale * 100)}%`;

                status.textContent = "Dokumen berhasil dimuat.";

                prevButton.disabled = currentPage <= 1;
                nextButton.disabled = currentPage >= pdf.numPages;

                zoomInButton.disabled = scale >= 2;
                zoomOutButton.disabled = scale <= 0.5;

            } catch (error) {
                if (error.name !== "RenderingCancelledException") {
                    console.error("Gagal merender PDF:", error);
                }
            }
        }
        
        try {
            const loadingTask = pdfjsLib.getDocument(config.url);
            
            pdf = await loadingTask.promise;
            currentPage = 1;
            status.textContent = "Dokumen berhasil dimuat.";
            
            await renderPage();
            
            prevButton.addEventListener("click", () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderPage();
                }
            });
            
            nextButton.addEventListener("click", () => {
                if (currentPage < pdf.numPages) {
                    currentPage++;
                    renderPage();
                }
            });
            
            zoomInButton.addEventListener("click", () => {
                scale = Math.min(2, scale + 0.25);
                renderPage();
            });
            
            zoomOutButton.addEventListener("click", () => {
                scale = Math.max(0.5, scale - 0.25);
                renderPage();
            });

            window.addEventListener("resize", renderPage);
        } catch (error) {
            console.error("Gagal memuat PDF:", error);
            status.textContent = "Gagal memuat dokumen PDF.";
            pageInfo.textContent = "Tidak tersedia";
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}