import { GoogleSheetsAPI } from "./api.js";
import { CSVParser } from "./csv.js";

document.addEventListener("DOMContentLoaded", async () => {
    const tableBody = document.getElementById("members-table-body");
    const countLabel = document.getElementById("member-count");
    const filterSelect = document.getElementById("filter-tugas");
    
    let allMembers = [];
   
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

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}