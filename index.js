const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());
app.use(cors());

// Render မှ သတ်မှတ်ပေးမည့် Port သို့မဟုတ် Local တွင် 3000
const PORT = process.env.PORT || 3000;

// သိုလှောင်ရန် (Database မရှိသေးခင် Memory တွင် သိမ်းရန်)
let connectedBots = {}; // token -> { botName, botInstance }
let customers = [];     // ဝင်လာသော customer များကို သိမ်းရန်
let messages = [];      // ဖောက်သည်များထံမှ ဝင်လာသော စာများကို သိမ်းရန်

// ပင်မ Server စမ်းသပ်ရန် လင့်ခ်
app.get('/', (req, res) => {
    res.send('OMEGA7 CHATS Backend is running successfully!');
});

// ၁. Telegram Bot Token ချိတ်ဆက်ခြင်း API
app.post('/api/connect-bot', async (req, res) => {
    try {
        const { botName, botToken } = req.body;
        if (!botToken) {
            return res.status(400).json({ success: false, error: "Bot Token is required" });
        }

        // Telegraf ဖြင့် Bot ကို Initialize လုပ်ခြင်း
        const bot = new Telegraf(botToken);

        // Bot အလုပ်လုပ်ပုံ Logic များ
        bot.start((ctx) => {
            const chatId = ctx.chat.id;
            const firstName = ctx.from.first_name || "Customer";
            
            // Customer စာရင်းထဲသို့ ထည့်မည် (မရှိသေးെങ്കിൽ)
            if (!customers.find(c => c.chatId === chatId)) {
                customers.push({ chatId, name: firstName });
            }

            ctx.reply(`မင်္ဂလာပါ! OMEGA7 CHATS မှ ကြိုဆိုပါတယ်။ ဘာများ ကူညီပေးရမလဲရှင့်?`);
        });

        // စာများ ပို့လာပါက လက်ခံ၍ messages ထဲသို့ သိမ်းမည်
        bot.on('text', (ctx) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text;
            const firstName = ctx.from.first_name || "Customer";

            let customer = customers.find(c => c.chatId === chatId);
            if (!customer) {
                customer = { chatId, name: firstName };
                customers.push(customer);
            }

            // ဝင်လာသော စာများကို သိမ်းဆည်းမည်
            messages.push({ 
                botToken, 
                chatId, 
                name: firstName, 
                text, 
                time: new Date().toLocaleTimeString() 
            });

            console.log(`Message from ${firstName} (${chatId}): ${text}`);
        });

        // Telegram သို့ Webhook ချိတ်ဆက်ခြင်း
        const renderUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        await bot.telegram.setWebhook(`${renderUrl}/webhook/${botToken}`);

        connectedBots[botToken] = { botName, bot };

        res.json({ success: true, message: "Bot connected and webhook set successfully!" });
    } catch (error) {
        console.error("Connect bot error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ၂. Telegram Webhook Endpoint
app.post('/webhook/:token', (req, res) => {
    const token = req.params.token;
    const botData = connectedBots[token];

    if (botData && botData.bot) {
        botData.bot.handleUpdate(req.body);
    }
    res.sendStatus(200);
});

// ၃. Dashboard မှ စာများကို လှမ်းယူရန် API
app.get('/api/messages', (req, res) => {
    res.json({ success: true, messages, customers });
});

// ၄. Broadcast ပို့ခြင်း API (ဖောက်သည်များအားလုံးဆီ ပုံနှင့်စာ တပြိုင်တည်းပို့ရန်)
app.post('/api/broadcast', async (req, res) => {
    try {
        const { botToken, message, imageUrl } = req.body;
        const botData = connectedBots[botToken];

        if (!botData) {
            return res.status(400).json({ success: false, error: "Bot not found or not connected!" });
        }

        let successCount = 0;
        let failCount = 0;

        for (const cust of customers) {
            try {
                if (imageUrl) {
                    await botData.bot.telegram.sendPhoto(cust.chatId, imageUrl, { caption: message });
                } else {
                    await botData.bot.telegram.sendMessage(cust.chatId, message);
                }
                successCount++;
            } catch (err) {
                console.error(`Failed to send to ${cust.chatId}:`, err);
                failCount++;
            }
        }

        res.json({ 
            success: true, 
            message: `Broadcast sent successfully! Success: ${successCount}, Failed: ${failCount}` 
        });
    } catch (error) {
        console.error("Broadcast error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ဆာဗာ စတင်ခြင်း
app.listen(PORT, () => {
    console.log(`OMEGA7 Backend Server is running on port ${PORT}`);
});
