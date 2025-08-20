// server.js
// 1. Import library yang dibutuhin
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Crisp = require('crisp-api');

// Inisialisasi Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Endpoint untuk mengecek apakah server hidup
app.get('/', (req, res) => {
  res.send('Server backend Crisp Widget berjalan!');
});

// 2. Konfigurasi Crisp API Client
// PENTING: Ganti dengan kredensial Crisp punya abang
//const crispClient = new Crisp();
//crispClient.authenticate(
//    process.env.CRISP_IDENTIFIER,
//    process.env.CRISP_KEY
//);
//const WEBSITE_ID = process.env.WEBSITE_ID;

// -----------------------------------------------------------------------------
// KONEKSI DATABASE MONGODB
const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.MONGO_URI;

// Konfigurasi koneksi MongoDB dengan opsi lengkap
const mongoClient = new MongoClient(uri, {
    tls: true,
    tlsAllowInvalidCertificates: true, // Sementara untuk testing
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db;
async function connectDB() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("crisp_data");
        console.log('🎉 Berhasil konek ke Database');
    } catch (e) {
        console.error('❌ Gagal konek ke Database', e);
        process.exit(1);
    }
}
connectDB();

// Endpoint untuk testing koneksi MongoDB
app.get('/test-mongo', async (req, res) => {
  try {
    await mongoClient.connect();
    res.json({ status: 'MongoDB connected successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------

// 3. API Endpoints
/**
 * @route   GET /api/get-facebook-psid/:sessionId
 * @desc    Mengambil Facebook PSID dari Crisp menggunakan session_id
*/
/*
app.get('/api/get-facebook-psid/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const sessionData = await crispClient.website.getSessionData(WEBSITE_ID, sessionId);
        const peopleId = sessionData.people_id;
        if (!peopleId) {
            return res.status(404).json({
                success: false,
                message: 'People ID tidak ditemukan di sesi ini.'
            });
        }
        const peopleData = await crispClient.website.getPeopleProfile(WEBSITE_ID, peopleId);
        const facebookPSID = peopleData.data.segments.find(segment => segment.startsWith('facebook:'))?.split(':')[1];
        if (facebookPSID) {
            res.json({
                success: true,
                facebook_psid: facebookPSID
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Facebook PSID tidak ditemukan untuk user ini.'
            });
        }
    } catch (error) {
        console.error('❌ Error getting Facebook PSID:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});
*/

/**
 * @route   GET /api/customer-status/:facebookPsid
 * @desc    Mengambil status customer terbaru beserta history-nya dari database
 */
app.get('/api/customer-status/:facebookPsid', async (req, res) => {
    const { facebookPsid } = req.params;
    try {
        // Ganti bagian ini dengan query ke database abang yang beneran
        const customer = await db.collection('customer_statuses').findOne({
            facebook_psid: facebookPsid
        });
        if (customer) {
            res.json({
                success: true,
                data: {
                    current_status: customer.current_status,
                    status_history: customer.status_history,
                    metadata: customer.metadata,
                    updated_at: customer.updated_at,
                    facebook_psid: customer.facebook_psid
                }
            });
        } else {
            res.json({
                success: false,
                message: 'Customer not found'
            });
        }
    } catch (error) {
        console.error('❌ Error getting customer status:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * @route   POST /api/customer-status
 * @desc    Membuat atau mengupdate status customer dengan tracking history
 */
app.post('/api/customer-status', async (req, res) => {
    const { facebook_psid, status, session_id, agent_id } = req.body;
    if (!facebook_psid || !status) {
        return res.status(400).json({ success: false, message: 'facebook_psid dan status wajib diisi.' });
    }
    try {
        const currentDate = new Date();
        const historyEntry = {
            status: status,
            timestamp: currentDate,
            session_id: session_id,
            updated_by: agent_id || 'system' // Default 'system' jika agent_id tidak ada
        };
        
        // Query canggih: update data yang ada, atau buat baru jika belum ada (upsert: true)
        const result = await db.collection('customer_statuses').updateOne(
            { facebook_psid: facebook_psid },
            {
                $set: {
                    current_status: status,
                    updated_at: currentDate,
                    'metadata.last_seen': currentDate
                },
                $push: {
                    status_history: historyEntry
                },
                $setOnInsert: { // Hanya dijalankan saat data baru dibuat
                    facebook_psid: facebook_psid,
                    created_at: currentDate,
                    'metadata.first_seen': currentDate
                }
            },
            { upsert: true } // Ini kuncinya!
        );
        
        // (Opsional) Broadcast update via WebSocket ke semua agen yang lagi online
        // broadcastStatusUpdate(facebook_psid, status);
        
        res.json({
            success: true,
            message: 'Status berhasil diupdate',
            data: {
                facebook_psid,
                current_status: status,
                updated_at: currentDate
            }
        });
    } catch (error) {
        console.error('❌ Error updating status:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * @route   GET /crisp-widget.js
 * @desc    Menyajikan file widget dinamis yang sudah disuntik API_BASE_URL
 */
app.get('/crisp-widget.js', (req, res) => {
    // Tentukan path ke file widget "cetakan" kita
    const widgetPath = path.join(__dirname, 'crisp-widget/crisp-status-widget.js');
    // Baca file widget sebagai teks
    fs.readFile(widgetPath, 'utf8', (err, data) => {
        if (err) {
            console.error("❌ Gagal membaca file widget:", err);
            return res.status(500).send('// Gagal memuat widget.');
        }
        // "Suntik" domain dari .env ke dalam placeholder
        const finalScript = data.replace(
            /__API_BASE_URL__/g, 
            process.env.API_BASE_URL
        );
        // Kirim hasilnya sebagai file Javascript
        res.type('.js');
        res.send(finalScript);
    });
});

// 4. Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di port ${PORT}`);
});
