// --- STATE ---
let users = JSON.parse(localStorage.getItem('xc_users_v2')) || [];
let transactions = JSON.parse(localStorage.getItem('xc_tx_v2')) || [];
let currentMode = 'idle'; // idle, pay_card, pay_id, bind_new, rebind, find_edit
let pendingUserId = null;
let pendingAmount = 0;
let reader = null;
let audioCtx = null;
let isProcessing = false;
let addWithNfc = true; // Flag for admin mode

// --- INIT ---
window.onload = () => {
    renderUsers();
    renderTransactions();
};

function saveDB() {
    localStorage.setItem('xc_users_v2', JSON.stringify(users));
    localStorage.setItem('xc_tx_v2', JSON.stringify(transactions));
    renderUsers();
    renderTransactions();
}

// --- AUDIO SYSTEM ---
function playSuccessSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, t); 
    osc1.frequency.exponentialRampToValueAtTime(1760, t + 0.1); 
    gain1.gain.setValueAtTime(0.1, t);
    gain1.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(t);
    osc1.stop(t + 0.3);
}

function playErrorSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(100, t + 0.2);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
}

// --- HELPERS ---
function generateUniqueId() {
    let id;
    do {
        id = Math.floor(100000 + Math.random() * 900000).toString();
    } while (users.some(u => u.id === id));
    return id;
}

function getUserByIdentifier(identifier) {
    return users.find(u => u.id === identifier);
}

function getUserByUid(uid) {
    return users.find(u => u.uid === uid);
}

// --- UI NAVIGATION ---
function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('act'));
    
    if(tab === 'main') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('p-main').classList.add('act');
    } else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('p-admin').classList.add('act');
    }
}

// --- RENDERING ---
function renderUsers() {
    const list = document.getElementById('user-list');
    const count = document.getElementById('user-count');
    list.innerHTML = '';
    count.innerText = users.length;

    if(users.length === 0) {
        list.innerHTML = '<li style="text-align:center;color:var(--mut);padding:20px">Нет клиентов</li>';
        return;
    }

    users.forEach(u => {
        const li = document.createElement('li');
        li.className = 'list-item';
        li.style.flexDirection = 'column';
        li.style.alignItems = 'stretch';
        
        const balColor = u.balance > 0 ? 'var(--acc)' : 'var(--danger)';
        const hasUid = u.uid ? '✅ Привязана' : '❌ Нет карты';
        
        li.innerHTML = `
            <div style="display:flex;justify-content:space-between;width:100%">
                <strong>${u.name}</strong>
                <span style="color:${balColor};font-family:monospace">${u.balance.toFixed(2)} ₽</span>
            </div>
            <div style="display:flex;justify-content:space-between;width:100%;margin-top:5px">
                <small style="color:var(--mut)">ID: ${u.id}</small>
                <small style="color:var(--mut)">${hasUid}</small>
            </div>
            <div class="u-actions">
                ${!u.uid ? `<button class="u-btn btn-bind" onclick="initRebind('${u.uuid}')">🔗 Привязать</button>` : ''}
                <button class="u-btn btn-add" onclick="initTopUp('${u.uuid}')">➕ Пополнить</button>
                <button class="u-btn btn-del" onclick="deleteUser('${u.uuid}')">🗑 Удалить</button>
            </div>
        `;
        list.appendChild(li);
    });
}

function renderTransactions() {
    const list = document.getElementById('tx-history');
    list.innerHTML = '';
    const recent = [...transactions].reverse().slice(0, 10);
    
    if(recent.length === 0) {
        list.innerHTML = '<li style="text-align:center;color:var(--mut);padding:10px">Нет операций</li>';
        return;
    }

    recent.forEach(tx => {
        const user = users.find(u => u.uuid === tx.userId);
        const name = user ? user.name : 'Unknown';
        const li = document.createElement('li');
        li.className = 'list-item';
        li.innerHTML = `
            <div class="item-info">
                <strong>${name}</strong>
                <small>${new Date(tx.time).toLocaleTimeString()}</small>
            </div>
            <div class="item-amt amt-neg">-${tx.amount} ₽</div>
        `;
        list.appendChild(li);
    });
}

// --- PAYMENT LOGIC ---
function startPaymentByCard() {
    const amtInput = document.getElementById('pay-amount');
    const amount = parseFloat(amtInput.value);
    if(!amount || amount <= 0) return alert("Введите сумму!");
    
    currentMode = 'pay_card';
    pendingAmount = amount;
    openScanModal();
}

function startPaymentByID() {
    const amtInput = document.getElementById('pay-amount');
    const amount = parseFloat(amtInput.value);
    if(!amount || amount <= 0) return alert("Введите сумму!");
    
    const idStr = prompt("Введите ID клиента для оплаты:");
    if(!idStr) return;

    const user = getUserByIdentifier(idStr.trim());
    if(!user) {
        playErrorSound();
        showResult("Ошибка", "Клиент с таким ID не найден.", false);
        return;
    }

    processPaymentLogic(user, amount);
}

function startFindClient() {
    currentMode = 'find_edit';
    openScanModal();
}

// --- TRANSFER LOGIC ---
function openTransferModal() {
    document.getElementById('modal-transfer').classList.add('show');
}

function executeTransfer() {
    const fromId = document.getElementById('tr-from-id').value.trim();
    const toId = document.getElementById('tr-to-id').value.trim();
    const amount = parseFloat(document.getElementById('tr-amount').value);

    if(!fromId || !toId || !amount || amount <= 0) return alert("Заполните все поля корректно.");
    if(fromId === toId) return alert("Нельзя перевести самому себе.");

    const sender = getUserByIdentifier(fromId);
    const receiver = getUserByIdentifier(toId);

    if(!sender) return alert("Отправитель не найден.");
    if(!receiver) return alert("Получатель не найден.");
    if(sender.balance < amount) return alert("Недостаточно средств у отправителя.");

    // Execute
    sender.balance -= amount;
    receiver.balance += amount;
    
    // Log transaction
    transactions.push({ time: Date.now(), amount: amount, userId: sender.uuid, status: 'transfer_out' });
    transactions.push({ time: Date.now(), amount: amount, userId: receiver.uuid, status: 'transfer_in' });

    saveDB();
    document.getElementById('modal-transfer').classList.remove('show');
    playSuccessSound();
    showResult("Перевод выполнен!", `${fromId} -> ${toId}: ${amount} ₽`, true);
}

// --- USER MANAGEMENT ---
function openAddUserMenu() {
    document.getElementById('modal-add-choice').classList.add('show');
}

async function openAddUserForm(withNfc) {
    addWithNfc = withNfc;
    document.getElementById('modal-add-choice').classList.remove('show');
    
    // Biometric Check for Admin Mode
    if (!withNfc) {
        try {
            if(window.PublicKeyCredential) {
                 await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:"Xcortex"},user:{id:new TextEncoder().encode("admin"),name:"admin",displayName:"Admin"},pubKeyCredParams:[{type:"public-key",alg:-7}],authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required"}}});
            }
        } catch(e) {}
    }

    document.getElementById('uf-title').innerText = withNfc ? "Новый клиент (NFC)" : "Новый клиент (Admin)";
    document.getElementById('uf-id').placeholder = "ID (оставьте пустым для авто)";
    document.getElementById('modal-user-form').classList.add('show');
}

function saveNewUser() {
    const name = document.getElementById('uf-name').value.trim();
    let id = document.getElementById('uf-id').value.trim();
    const bal = parseFloat(document.getElementById('uf-balance').value) || 0;
    
    if(!name) return alert("Введите ФИО!");
    if(!id) id = generateUniqueId();
    else if(getUserByIdentifier(id)) return alert("Такой ID уже существует!");

    const newUser = { 
        uuid: Date.now().toString(), // Internal unique key
        id: id,                      // Public Identifier
        name: name, 
        balance: bal, 
        uid: null 
    };
    
    users.push(newUser);
    saveDB();
    
    document.getElementById('modal-user-form').classList.remove('show');
    document.getElementById('uf-name').value = '';
    document.getElementById('uf-id').value = '';
    document.getElementById('uf-balance').value = '0';
    
    if(addWithNfc) {
        setTimeout(() => initBind(newUser.uuid), 300);
    } else {
        showResult("Готово!", "Клиент добавлен без карты.", true);
    }
}

function initBind(userIdInternal) {
    currentMode = 'bind_new';
    pendingUserId = userIdInternal;
    openScanModal();
}

function initRebind(userIdInternal) {
    if(confirm("Привязать новую карту?")) {
        initBind(userIdInternal);
    }
}

function initTopUp(userIdInternal) {
    const idx = users.findIndex(x => x.uuid === userIdInternal);
    if(idx === -1) return;
    
    const curBal = users[idx].balance;
    const addStr = prompt(`Текущий баланс: ${curBal}\nСколько начислить?`, "100");
    
    if(addStr !== null && !isNaN(parseFloat(addStr))) {
        const val = parseFloat(addStr);
        if(val > 0) {
            users[idx].balance += val;
            saveDB();
            showResult("Баланс пополнен!", `${users[idx].name}: +${val} ₽`, true);
        }
    }
}

function deleteUser(userIdInternal) {
    if(confirm("Удалить этого клиента навсегда?")) {
        users = users.filter(u => u.uuid !== userIdInternal);
        saveDB();
        showResult("Удалено", "Клиент удален из базы.", true);
    }
}

// --- NFC CORE ---
function openScanModal() {
    isProcessing = false;
    document.getElementById('modal-scan').classList.add('show');
    startNFCSearch();
}

function closeScanModal(success) {
    document.getElementById('modal-scan').classList.remove('show');
    stopScanner();
    if(!success) {
        currentMode = 'idle';
        pendingUserId = null;
        isProcessing = false;
    }
}

async function startNFCSearch() {
    if(!('NDEFReader' in window)) {
        showResult("Ошибка", "Web NFC не поддерживается.", false);
        closeScanModal(false);
        return;
    }

    try {
        reader = new NDEFReader();
        reader.addEventListener("reading", async ({ serialNumber }) => {
            if (isProcessing) return; 
            isProcessing = true; 
            
            try { await reader.stop(); } catch(e){}
            
            processTagFound(serialNumber);
        });
        await reader.scan();
    } catch (err) {
        console.error(err);
        showResult("Ошибка сканера", err.message, false);
        closeScanModal(false);
    }
}

async function stopScanner() {
    if(reader) {
        try { await reader.stop(); } catch(e){}
        reader = null;
    }
    isProcessing = false;
}

function processTagFound(uid) {
    document.getElementById('modal-scan').classList.remove('show');
    
    if(currentMode === 'pay_card') {
        handlePaymentByUid(uid, pendingAmount);
    } else if (currentMode === 'bind_new' || currentMode === 'rebind') {
        handleBinding(uid);
    } else if (currentMode === 'find_edit') {
        handleFindAndEdit(uid);
    }
    
    currentMode = 'idle';
    pendingUserId = null;
    isProcessing = false; 
}

function handleBinding(uid) {
    if(!pendingUserId) return;
    const idx = users.findIndex(x => x.uuid === pendingUserId);
    if(idx !== -1) {
        const existing = users.find(x => x.uid === uid && x.uuid !== pendingUserId);
        if(existing) {
            showResult("Конфликт карт", `Эта карта уже у: ${existing.name}`, false);
            return;
        }
        users[idx].uid = uid;
        saveDB();
        showResult("Готово!", "Карта успешно привязана.", true);
    }
}

function handlePaymentByUid(uid, amount) {
    const user = getUserByUid(uid);
    if(!user) {
        playErrorSound();
        showResult("Карта неизвестна", "Обратитесь к админу.", false);
        return;
    }
    processPaymentLogic(user, amount);
}

function processPaymentLogic(user, amount) {
    if(user.balance < amount) {
        playErrorSound();
        const diff = amount - user.balance;
        showResult("Недостаточно средств", `Не хватает: ${diff.toFixed(2)} ₽`, false);
        return;
    }
    
    user.balance -= amount;
    transactions.push({ time: Date.now(), amount, userId: user.uuid, status: 'success' });
    saveDB();
    
    playSuccessSound(); 
    showResult("Оплата успешна!", `${user.name}: -${amount} ₽\nОстаток: ${user.balance.toFixed(2)} ₽`, true);
    document.getElementById('pay-amount').value = '';
}

function handleFindAndEdit(uid) {
    const user = getUserByUid(uid);
    if(!user) {
        showResult("Не найдено", "Карта не зарегистрирована в системе.", false);
        return;
    }
    
    // Open Edit Modal
    document.getElementById('ec-uid-display').innerText = uid;
    document.getElementById('ec-name').value = user.name;
    document.getElementById('ec-id').value = user.id;
    document.getElementById('ec-balance').value = user.balance;
    
    // Store context for saving
    window._editingUserUuid = user.uuid;
    
    document.getElementById('modal-edit-client').classList.add('show');
}

function saveEditedClient() {
    const uuid = window._editingUserUuid;
    const idx = users.findIndex(u => u.uuid === uuid);
    if(idx === -1) return;

    const newName = document.getElementById('ec-name').value.trim();
    const newId = document.getElementById('ec-id').value.trim();
    const newBal = parseFloat(document.getElementById('ec-balance').value);

    if(!newName) return alert("Имя обязательно");
    if(newId && newId !== users[idx].id && getUserByIdentifier(newId)) return alert("ID занят другим клиентом");
    if(isNaN(newBal)) return alert("Неверный баланс");

    users[idx].name = newName;
    users[idx].id = newId;
    users[idx].balance = newBal;
    
    saveDB();
    document.getElementById('modal-edit-client').classList.remove('show');
    showResult("Обновлено", "Данные клиента изменены.", true);
}

// --- FEEDBACK ---
function showResult(title, desc, isSuccess) {
    const modal = document.getElementById('modal-result');
    const icon = document.getElementById('res-icon');
    
    icon.innerText = isSuccess ? "✅" : "❌";
    icon.className = isSuccess ? "icon-big icon-success" : "icon-big icon-error";
    
    document.getElementById('res-title').innerText = title;
    document.getElementById('res-desc').innerText = desc;
    modal.classList.add('show');
}
