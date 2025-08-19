// crisp-status-widget.js

// CLASS UNTUK CACHING (OPTIMASI PERFORMA)
class StatusCache {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // Cache berlaku selama 5 menit
    }

    get(facebookPsid) {
        const cached = this.cache.get(facebookPsid);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            console.log('CACHE HIT:', cached.data);
            return cached.data;
        }
        console.log('CACHE MISS');
        return null;
    }

    set(facebookPsid, data) {
        this.cache.set(facebookPsid, {
            data: data,
            timestamp: Date.now()
        });
        console.log('CACHE SET:', data);
    }
}


// KELAS UTAMA WIDGET
class CrispStatusWidget {
    constructor() {
        // --- 1. Inisialisasi Properti ---
        this.facebookPSID = null;
        this.currentStatus = null;
        this.currentSessionId = null;
        this.commandMode = false;
        this.apiBaseUrl = '__API_BASE_URL__'; // GANTI DENGAN URL SERVER ABANG
        this.statusCache = new StatusCache();

        // Daftar status beserta shortcut dan labelnya
        this.statuses = {
            'B': { key: 'belum_daftar', label: '📝 Belum Daftar' },
            'S': { key: 'sudah_daftar', label: '✅ Sudah Daftar' },
            'D': { key: 'memberikan_data', label: '📊 Memberikan Data' },
            'U': { key: 'memberikan_userid', label: '🆔 Memberikan UserID' },
            'H': { key: 'butuh_bantuan_daftar', label: '❓ Butuh Bantuan Daftar' },
            'P': { key: 'spam', label: '🚫 Spam' }
        };

        // --- 2. Setup Event Listeners ---
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        
        // Menunggu Crisp siap
        $crisp.push(["on", "session:loaded", (sessionId) => {
            this.currentSessionId = sessionId;
            this.init();
        }]);
    }

    // --- 3. Logika Utama Saat Widget Dimuat ---
    async init() {
        console.log("Widget init...");
        const sessionChannel = $crisp.get("session:identifier");

        // Hanya aktifkan jika chat berasal dari Facebook
        if (sessionChannel !== "facebook") {
            console.log("Bukan sesi Facebook, widget tidak aktif.");
            return;
        }

        // Buat indikator command mode (lingkaran merah)
        this.createCommandIndicator();
        
        // Ambil Facebook PSID dari server
        await this.fetchFacebookPSID();

        // Muat data customer (status)
        await this.loadCustomerData();

        // Tampilkan widget di chat
        this.showWidget();
    }

    async fetchFacebookPSID() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/get-facebook-psid/${this.currentSessionId}`);
            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.facebookPSID = result.facebook_psid;
                    console.log('✅ Facebook PSID didapatkan:', this.facebookPSID);
                } else {
                    console.error('Gagal mendapatkan PSID dari server:', result.message);
                }
            } else {
                 console.error('Error HTTP saat fetch PSID:', response.statusText);
            }
        } catch (error) {
            console.error('❌ Error fatal saat fetch PSID:', error);
        }
    }

    // --- 4. Alur Pengambilan Data Status (dengan 3 Prioritas) ---
    async loadCustomerData() {
        try {
            // PRIORITAS 1: Cek di Crisp Session Data (Real-time & Cepat)
            const sessionData = $crisp.get("session:data");
            if (sessionData && sessionData.customer_status) {
                this.currentStatus = sessionData.customer_status;
                console.log('✅ Status dimuat dari Crisp session:', this.currentStatus);
                return;
            }

            // PRIORITAS 2: Cek di Database Server (Persistent)
            if (this.facebookPSID) {
                const serverStatus = await this.getStatusFromServer();
                if (serverStatus) {
                    this.currentStatus = serverStatus;
                    // Simpan ke Crisp session untuk cache lokal di tab lain
                    $crisp.push(["set", "session:data", [["customer_status", serverStatus]]]);
                    console.log('✅ Status dimuat dari server:', this.currentStatus);
                    return;
                }
            }

            // PRIORITAS 3: Gunakan Default Status
            this.currentStatus = 'belum_daftar';
            console.log('⚠️ Menggunakan status default:', this.currentStatus);

        } catch (error) {
            console.error('❌ Error saat memuat data customer:', error);
            this.currentStatus = 'belum_daftar'; // Fallback jika ada error
        }
    }

    async getStatusFromServer() {
        // Cek cache dulu sebelum hit API
        const cached = this.statusCache.get(this.facebookPSID);
        if (cached) {
            return cached.current_status;
        }
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/customer-status/${this.facebookPSID}`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    // Simpan ke cache untuk request berikutnya
                    this.statusCache.set(this.facebookPSID, result.data);
                    return result.data.current_status;
                }
            }
        } catch (error) {
            console.error('❌ Error fetching status dari server:', error);
        }
        return null;
    }

    // --- 5. Logika Update Status ---
    async updateStatus(statusInfo) {
        if (!this.facebookPSID) {
             $crisp.push(["do", "message:show", ["text", "❌ Gagal update: Facebook PSID tidak ditemukan."]]);
             return;
        }
        
        // 1. Update di Crisp Session Data (untuk respon UI instan)
        this.currentStatus = statusInfo.key;
        $crisp.push(["set", "session:data", [
            ["customer_status", statusInfo.key]
        ]]);

        // 2. Kirim data ke server untuk disimpan permanen
        await this.sendStatusToServer(statusInfo.key);

        // 3. Tampilkan konfirmasi visual yang baru dan lebih baik
        this.showWidget();
    }

    async sendStatusToServer(status) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/customer-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    facebook_psid: this.facebookPSID,
                    status: status,
                    session_id: this.currentSessionId,
                    timestamp: new Date().toISOString()
                    // agent_id bisa ditambahkan jika abang bisa mendapatkannya dari Crisp
                })
            });

            if (!response.ok) {
                throw new Error('Gagal update status di server');
            }
            const result = await response.json();
            console.log('✅ Status berhasil disimpan di database:', result);
            $crisp.push(["do", "message:show", ["text", `✅ Status diupdate ke: **${this.statuses[Object.keys(this.statuses).find(key => this.statuses[key].key === status)].label}**`]]);
            
        } catch (error) {
            console.error('❌ Error menyimpan status ke database:', error);
            $crisp.push(["do", "message:show", ["text", "❌ Gagal menyimpan status ke database."]]);
        }
    }

    // --- 6. Handler untuk Keyboard Shortcut ---
    handleKeyDown(event) {
        // Aktifkan command mode dengan titik koma (;)
        if (event.key === ';') {
            event.preventDefault();
            this.commandMode = true;
            this.showCommandIndicator();
            return;
        }

        if (this.commandMode) {
            event.preventDefault();
            const key = event.key.toUpperCase();

            // Keluar command mode dengan backtick (`) atau Escape
            if (key === '`' || event.key === 'Escape') {
                this.commandMode = false;
                this.hideCommandIndicator();
                return;
            }

            const statusInfo = this.statuses[key];
            if (statusInfo) {
                this.updateStatus(statusInfo);
            }
            
            this.commandMode = false;
            this.hideCommandIndicator();
        }
    }

    // --- 7. Tampilan Visual Widget ---
    showWidget() {
        const statusInfo = this.getStatusInfo(this.currentStatus);

        const statusDisplay = {
            type: "text",
            content: `
╔══════════════════════════════════════╗
║                🎯 CUSTOMER STATUS                  ║
╠══════════════════════════════════════╣
║                                                      ║
║  **Status Saat Ini: ${statusInfo.label.padEnd(25)}** ║
║  PSID: \`${this.facebookPSID || 'Tidak Ditemukan'}\`      ║
║                                                      ║
╚══════════════════════════════════════╝
            `
        };
        $crisp.push(["do", "message:show", ["text", statusDisplay.content]]);
        $crisp.push(["do", "message:show", ["text", "💡 Tekan **;** lalu **(B/S/D/U/H/P)** untuk update status."]]);
    }
    
    getStatusInfo(statusKey) {
        const statusMap = {
            'belum_daftar': { label: '📝 Belum Daftar' },
            'sudah_daftar': { label: '✅ Sudah Daftar' },
            'memberikan_data': { label: '📊 Memberikan Data' },
            'memberikan_userid': { label: '🆔 Memberikan UserID' },
            'butuh_bantuan_daftar': { label: '❓ Butuh Bantuan Daftar' },
            'spam': { label: '🚫 Spam' }
        };
        return statusMap[statusKey] || { label: '❓ Status Tidak Diketahui' };
    }

    // --- 8. Helper untuk Indikator Command Mode ---
    createCommandIndicator() {
        this.indicator = document.createElement('div');
        this.indicator.id = 'command-indicator';
        Object.assign(this.indicator.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '15px',
            height: '15px',
            backgroundColor: '#FF4136',
            borderRadius: '50%',
            zIndex: '9999',
            opacity: '0',
            transition: 'opacity 0.2s'
        });
        document.body.appendChild(this.indicator);
    }
    
    showCommandIndicator() { this.indicator.style.opacity = '1'; }
    hideCommandIndicator() { this.indicator.style.opacity = '0'; }
}


// --- INSIALISASI WIDGET ---
// Pastikan script dijalankan setelah halaman dan Crisp siap
document.addEventListener('DOMContentLoaded', () => {
    if (typeof $crisp !== 'undefined') {
        window.crispStatusWidget = new CrispStatusWidget();
    } else {
        console.error("Crisp SDK belum siap.");
    }
});
