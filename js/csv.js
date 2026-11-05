export const CSVParser = {
    parse(csv) {
        const lines = csv.trim().split(/\r?\n/)
        if (lines.length < 2) {
            return [];
        }
        
        const headers = this.parseRow(lines[0]);
        
        return lines.slice(1).map(line => {
            const values = this.parseRow(line);
            const item = {};
            
            headers.forEach((header, index) => {
                item[header.trim()] = values[index] ?? "";
            });
           
            return this.format(item);
        });
    },
    
    parseRow(row) {
        const result = [];
        let value = "";
        let insideQuotes = false;
        
        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            if (char === '"') {
                if (insideQuotes && row[i + 1] === '"') {
                    value += '"';
                    i++;
                } else {
                    insideQuotes = !insideQuotes;
                }
            
            } else if (char === "," && !insideQuotes) {
                result.push(value);
                value = "";
            } else {
                value += char;
            }
        }
       
        result.push(value);
        return result;
    },
    
    format(item) {
        return {
            timestamp: this.formatDate(item["Timestamp"]),
            email: item["Email Address"]?.trim()
                || "Tidak ditentukan",
            
            nama: item["Nama:"]?.trim()
                || "Tidak ditentukan",
            
            tugas : item["Anda ingin menjadi."]?.trim()
                || "Tidak ditentukan"
        };
    },
  
    formatDate(value) {
        if (!value) {
            return "Tidak ditentukan";
        }
      
        const match = value.match(
            /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/
        );

        if (!match) {
            return value;
        }
      
        const [, day, month, year, hour, minute, second] = match;
        const date = new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second)
        );
      
        return new Intl.DateTimeFormat("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(date);
    }
};