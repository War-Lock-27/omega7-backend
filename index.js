const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Telegraf } = require('telegraf');

const app = express();
app.use(express.json());
app.use(cors());

// Render မှ သတ်မှတ်ပေးမည့် Port သို့မဟုတ် Local တွင် 3000
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// MongoDB Database သို့ ချိတ်ဆက်ခြင်း
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected successfully!'))
    .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Schemas & Models (ဒေတာအမြဲတမ်းသိမ်းဆည်းရန်)
const customerSchema = new mongoose.Schema({
    chatId: { type: Number, unique: true },
    name: String
});
const Customer = mongoose.model('Customer', customerSchema);

const messageSchema = new mongoose.Schema({
    botToken: String,
    chatId: Number,
    name: String,
    text: String,
    time: String
});
const Message = mongoose.model('Message', messageSchema);

// သိုလှောင်ရန် (Connected Bots များကို Memory တွင် ထိန်းသိမ်းမည်)
let connectedBots = {}; // token -> { botName, bot }

// ပင်မ Server စမ်းသပ်ရန် လင့်ခ်
app.get('/', (req, res) => {
    res.send('OMEGA7 CHATS Backend is running with MongoDB successfully!');
});

// ၁. Telegram Bot Token ချိတ်ဆက်ခြင်း API
app.post('/api/connect-bot', async (req, res) => {
    try {
        const { botName, botToken } = req.body;
        if (!botToken) {
            return res.status(400).json({ success: false, error: "Bot Token is required" });
        }

        const bot = new Telegraf(botToken);

        bot.start(async (ctx) => {
            const chatId = ctx.chat.id;
            const firstName = ctx.from.first_name || "Customer";
            
            try {
                // Database ထဲတွင် Customer ရှိမရှိ စစ်ဆေးပြီး မရှိလျှင် အသစ်ထည့်မည်
                let existingCustomer = await Customer.findOne({ chatId });
                if (!existingCustomer) {
                    await Customer.create({ chatId, name: firstName });
                }
            } catch (dbErr) {
                console.error("DB error on start:", dbErr);
            }

            ctx.reply(`မင်္ဂလာပါ! OMEGA7 CHATS မှ ကြိုဆိုပါတယ်။ ဘာများ ကူညီပေးရမလဲရှင့်?`);
        });

        bot.on('text', async (ctx) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text;
            const firstName = ctx.from.first_name || "Customer";

            try {
                let existingCustomer = await Customer.findOne({ chatId });
                if (!existingCustomer) {
                    await Customer.create({ chatId, name: firstName });
                }

                // ဝင်လာသော စာများကို Database ထဲသို့ သိမ်းမည်
                await Message.create({
                    botToken,
                    chatId,
                    name: firstName,
                    text,
                    time: new Date().toLocaleTimeString()
                });
            } catch (dbErr) {
                console.error("DB error on text:", dbErr);
            }

            console.log(`Message from ${firstName} (${chatId}): ${text}`);
        });

        const renderUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        await bot.telegram.setWebhook(`${renderUrl}/webhook/${botToken}`);

        connectedBots[botToken] = { botName, bot };

        res.json({ success: true, message: "Bot connected and webhook set successfully with MongoDB!" });
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

// ၃. Dashboard မှ စာများကို Database မှ လှမ်းယူရန် API
app.get('/api/messages', async (req, res) => {
    try {
        const messages = await Message.find().sort({ _id: -1 }).limit(100); // နောက်ဆုံးစာ ၁၀၀ ကို ယူမည်
        const customers = await Customer.find();
        res.json({ success: true, messages: messages.reverse(), customers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ၄. Dashboard မှနေ၍ Telegram ဖောက်သည်ဆီသို့ တိုက်ရိုက်စာပြန်ရန် API
app.post('/api/reply', async (req, res) => {
    try {
        const { botToken, chatId, message } = req.body;
        const botData = connectedBots[botToken];

        if (!botData) {
            return res.status(400).json({ success: false, error: "Bot not connected!" });
        }

        await botData.bot.telegram.sendMessage(chatId, message);

        // ပို့လိုက်သော Admin စာကို Database ထဲသို့ သိမ်းမည်
        await Message.create({
            botToken,
            chatId,
            name: "Admin",
            text: message,
            time: new Date().toLocaleTimeString()
        });

        res.json({ success: true, message: "Reply sent successfully!" });
    } catch (error) {
        console.error("Reply error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ၅. Broadcast ပို့ခြင်း API
app.post('/api/broadcast', async (req, res) => {
    try {
        const { botToken, message, imageUrl } = req.body;
        const botData = connectedBots[botToken];

        if (!botData) {
            return res.status(400).json({ success: false, error: "Bot not found or not connected!" });
        }

        const customers = await Customer.find();
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
