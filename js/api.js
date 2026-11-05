const API_CONFIG = {
    spreadsheetUrl:
        "https://docs.google.com/spreadsheets/d/1V6ymg3szG7JySqctMW7oStP0_8jpVHQYFfSjY7ODPhk/export?format=csv"
};

export const GoogleSheetsAPI = {
    async getCSV() {
        
        try {
            const response = await fetch(
                API_CONFIG.spreadsheetUrl
            );
            
            if (!response.ok) {
                throw new Error(
                    `HTTP Error: ${response.status}`
                );
            }
            
            const csv = await response.text();
            return csv;
            
        } catch (error) {
            console.error(
                "[GoogleSheetsAPI]",
                error
            );
            
            throw error;
        }
    }
};