// Символы мастей
const SUIT_SYMBOLS = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
};

const SUIT_COLORS = {
    hearts: 'red',
    diamonds: 'red',
    clubs: 'black',
    spades: 'black'
};

// Состояние игры
let ws = null;
let playerId = null;
let gameState = null;
let selectedCard = null;
let selectedAttackCard = null;

// DOM элементы
const screens = {
    lobby: document.getElementById('lobby'),
    waiting: document.getElementById('waiting-room'),
    game: document.getElementById('game')
};

const elements = {
    playerName: document.getElementById('playerName'),
    createGameBtn: document.getElementById('createGameBtn'),
    joinGameBtn: document.getElementById('joinGameBtn'),
    gameCode: document.getElementById('gameCode'),
    roomCode: document.getElementById('roomCode'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    playerCount: document.getElementById('playerCount'),
    playersList: document.getElementById('playersList'),
    startGameBtn: document.getElementById('startGameBtn'),
    leaveRoomBtn: document.getElementById('leaveRoomBtn'),
    trumpCard: document.getElementById('trumpCard'),
    deckCount: document.getElementById('deckCount'),
    gameStatus: document.getElementById('gameStatus'),
    opponentsArea: document.getElementById('opponentsArea'),
    tableCards: document.getElementById('tableCards'),
    playerHand: document.getElementById('playerHand'),
    takeBtn: document.getElementById('takeBtn'),
    passBtn: document.getElementById('passBtn'),
    resultModal: document.getElementById('resultModal'),
    resultTitle: document.getElementById('resultTitle'),
    resultMessage: document.getElementById('resultMessage'),
    playAgainBtn: document.getElementById('playAgainBtn'),
    notifications: document.getElementById('notifications')
};

// Инициализация
function init() {
    // Загружаем сохранённое имя
    const savedName = localStorage.getItem('playerName');
    if (savedName) {
        elements.playerName.value = savedName;
    }

    // Обработчики событий
    elements.createGameBtn.addEventListener('click', createGame);
    elements.joinGameBtn.addEventListener('click', joinGame);
    elements.copyCodeBtn.addEventListener('click', copyGameCode);
    elements.startGameBtn.addEventListener('click', startGame);
    elements.leaveRoomBtn.addEventListener('click', leaveRoom);
    elements.takeBtn.addEventListener('click', takeCards);
    elements.passBtn.addEventListener('click', passAction);
    elements.playAgainBtn.addEventListener('click', playAgain);

    elements.gameCode.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinGame();
    });

    elements.playerName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createGame();
    });

    // Подключение к WebSocket
    connectWebSocket();
}

// WebSocket подключение
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('Подключено к серверу');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };

    ws.onclose = () => {
        console.log('Отключено от сервера');
        showNotification('Соединение потеряно. Перезагрузите страницу.', 'error');
    };

    ws.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
    };
}

// Обработка сообщений от сервера
function handleServerMessage(data) {
    switch (data.type) {
        case 'connected':
            playerId = data.playerId;
            break;

        case 'nameSet':
            localStorage.setItem('playerName', data.name);
            break;

        case 'gameCreated':
            showScreen('waiting');
            elements.roomCode.textContent = data.gameId;
            updateWaitingRoom(data.game);
            break;

        case 'playerJoined':
        case 'gameState':
            gameState = data.game;
            if (gameState.status === 'waiting') {
                updateWaitingRoom(gameState);
            } else if (gameState.status === 'playing') {
                showScreen('game');
                renderGame();
            } else if (gameState.status === 'finished') {
                showGameResult();
            }
            break;

        case 'gameStarted':
            showScreen('game');
            showNotification('Игра началась!', 'success');
            break;

        case 'playerLeft':
            showNotification(`${data.playerName} покинул игру`, 'info');
            break;

        case 'error':
            showNotification(data.message, 'error');
            break;
    }
}

// Переключение экранов
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName].classList.add('active');
}

// Создание игры
function createGame() {
    const name = elements.playerName.value.trim() || 'Игрок';
    ws.send(JSON.stringify({ type: 'setName', name }));
    ws.send(JSON.stringify({ type: 'createGame' }));
}

// Присоединение к игре
function joinGame() {
    const name = elements.playerName.value.trim() || 'Игрок';
    const code = elements.gameCode.value.trim().toUpperCase();

    if (!code) {
        showNotification('Введите код игры', 'error');
        return;
    }

    ws.send(JSON.stringify({ type: 'setName', name }));
    ws.send(JSON.stringify({ type: 'joinGame', gameId: code }));
}

// Копирование кода игры
function copyGameCode() {
    const code = elements.roomCode.textContent;
    navigator.clipboard.writeText(code).then(() => {
        showNotification('Код скопирован!', 'success');
    });
}

// Обновление комнаты ожидания
function updateWaitingRoom(game) {
    elements.roomCode.textContent = game.id;
    elements.playerCount.textContent = game.players.length;

    elements.playersList.innerHTML = game.players.map((player, index) => `
        <li class="${index === 0 ? 'host' : ''}">${player.name}</li>
    `).join('');

    // Хост может начать игру
    const isHost = game.players[0]?.id === playerId;
    elements.startGameBtn.disabled = !isHost || game.players.length < 2;
    elements.startGameBtn.textContent = isHost
        ? (game.players.length < 2 ? 'Ожидание игроков...' : 'Начать игру')
        : 'Ожидание хоста...';
}

// Начало игры
function startGame() {
    ws.send(JSON.stringify({ type: 'startGame' }));
}

// Покинуть комнату
function leaveRoom() {
    ws.send(JSON.stringify({ type: 'leaveGame' }));
    showScreen('lobby');
}

// Отрисовка игры
function renderGame() {
    if (!gameState) return;

    renderTrump();
    renderDeck();
    renderOpponents();
    renderTable();
    renderPlayerHand();
    renderActions();
    updateGameStatus();
}

// Отрисовка козыря
function renderTrump() {
    if (gameState.trumpCard) {
        const symbol = SUIT_SYMBOLS[gameState.trumpCard.suit];
        const color = SUIT_COLORS[gameState.trumpCard.suit];
        elements.trumpCard.innerHTML = `<span style="color: ${color === 'red' ? '#c0392b' : '#2c3e50'}">${gameState.trumpCard.value}${symbol}</span>`;
    } else if (gameState.trump) {
        const symbol = SUIT_SYMBOLS[gameState.trump];
        const color = SUIT_COLORS[gameState.trump];
        elements.trumpCard.innerHTML = `<span style="color: ${color === 'red' ? '#c0392b' : '#2c3e50'}">${symbol}</span>`;
    }
}

// Отрисовка колоды
function renderDeck() {
    elements.deckCount.textContent = gameState.deckCount;
}

// Отрисовка противников
function renderOpponents() {
    const opponents = gameState.players.filter(p => p.id !== playerId);

    elements.opponentsArea.innerHTML = opponents.map(opponent => {
        const roleClass = opponent.isAttacker ? 'attacker' : (opponent.isDefender ? 'defender' : '');
        const roleText = opponent.isAttacker ? ' (атакует)' : (opponent.isDefender ? ' (защищается)' : '');

        return `
            <div class="opponent">
                <div class="opponent-name ${roleClass}">${opponent.name}${roleText}</div>
                <div class="opponent-cards">
                    ${Array(opponent.cardCount).fill('<div class="opponent-card"></div>').join('')}
                </div>
            </div>
        `;
    }).join('');
}

// Отрисовка стола
function renderTable() {
    elements.tableCards.innerHTML = gameState.table.map(pair => {
        const isUnbeaten = !pair.defense;
        return `
            <div class="table-pair ${isUnbeaten ? 'unbeaten' : ''}" ${isUnbeaten ? `data-attack-id="${pair.attack.id}"` : ''}>
                ${renderCard(pair.attack, false, isUnbeaten)}
                ${pair.defense ? renderCard(pair.defense, false, false) : ''}
            </div>
        `;
    }).join('');

    // Добавляем обработчики для непобитых карт (если игрок защищается)
    const currentPlayer = gameState.players.find(p => p.id === playerId);
    if (currentPlayer && currentPlayer.isDefender && selectedCard) {
        document.querySelectorAll('.table-pair.unbeaten').forEach(pair => {
            pair.addEventListener('click', () => {
                const attackCardId = pair.dataset.attackId;
                defendCard(attackCardId);
            });
        });
    }
}

// Создание HTML карты
function renderCard(card, isSelectable = true, isHighlighted = false) {
    const symbol = SUIT_SYMBOLS[card.suit];
    const colorClass = card.suit;

    return `
        <div class="card ${colorClass} ${isHighlighted ? 'unbeaten-card' : ''}"
             data-card-id="${card.id}"
             ${isSelectable ? 'onclick="selectCard(this)"' : ''}>
            <div class="card-corner">
                <span class="card-value">${card.value}</span>
                <span class="card-suit">${symbol}</span>
            </div>
            <div class="card-center">${symbol}</div>
            <div class="card-corner bottom">
                <span class="card-value">${card.value}</span>
                <span class="card-suit">${symbol}</span>
            </div>
        </div>
    `;
}

// Отрисовка руки игрока
function renderPlayerHand() {
    elements.playerHand.innerHTML = gameState.myCards.map(card => renderCard(card, true)).join('');
}

// Выбор карты
function selectCard(cardElement) {
    const cardId = cardElement.dataset.cardId;
    const currentPlayer = gameState.players.find(p => p.id === playerId);

    // Убираем выделение с предыдущей карты
    document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));

    if (selectedCard === cardId) {
        selectedCard = null;
        return;
    }

    selectedCard = cardId;
    cardElement.classList.add('selected');

    // Если защитник и есть непобитые карты - ожидаем клик на карту стола
    if (currentPlayer.isDefender) {
        const unbeatCards = gameState.table.filter(p => !p.defense);
        if (unbeatCards.length > 0) {
            showNotification('Кликните на карту, которую хотите побить', 'info');
            return;
        }
    }

    // Если атакующий или подкидывающий - сразу атакуем
    if (currentPlayer.isAttacker || (!currentPlayer.isDefender && gameState.table.length > 0)) {
        attackWithCard(cardId);
    }
}

// Атака картой
function attackWithCard(cardId) {
    ws.send(JSON.stringify({
        type: 'attack',
        cardId: cardId
    }));
    selectedCard = null;
}

// Защита картой
function defendCard(attackCardId) {
    if (!selectedCard) {
        showNotification('Сначала выберите карту для защиты', 'error');
        return;
    }

    ws.send(JSON.stringify({
        type: 'defend',
        attackCardId: attackCardId,
        defenseCardId: selectedCard
    }));
    selectedCard = null;
}

// Взять карты
function takeCards() {
    ws.send(JSON.stringify({ type: 'take' }));
}

// Пас (бито)
function passAction() {
    ws.send(JSON.stringify({ type: 'pass' }));
}

// Отрисовка кнопок действий
function renderActions() {
    const currentPlayer = gameState.players.find(p => p.id === playerId);

    // Кнопка "Взять" для защитника
    const hasUnbeatCards = gameState.table.some(p => !p.defense);
    elements.takeBtn.style.display = currentPlayer.isDefender && hasUnbeatCards ? 'block' : 'none';

    // Кнопка "Бито" для атакующих (когда все карты побиты)
    const allBeaten = gameState.table.length > 0 && !hasUnbeatCards;
    elements.passBtn.style.display = !currentPlayer.isDefender && allBeaten ? 'block' : 'none';
}

// Обновление статуса игры
function updateGameStatus() {
    const currentPlayer = gameState.players.find(p => p.id === playerId);
    let status = '';

    if (currentPlayer.isAttacker) {
        status = 'Ваш ход! Атакуйте';
    } else if (currentPlayer.isDefender) {
        const unbeatCards = gameState.table.filter(p => !p.defense).length;
        if (unbeatCards > 0) {
            status = `Защищайтесь! (${unbeatCards} карт)`;
        } else {
            status = 'Ожидайте подкидывания';
        }
    } else if (gameState.table.length > 0) {
        status = 'Можете подкинуть карту';
    } else {
        status = 'Ожидайте хода';
    }

    elements.gameStatus.textContent = status;
}

// Показ результата игры
function showGameResult() {
    elements.resultModal.classList.add('active');

    if (gameState.loser) {
        const isLoser = gameState.players.find(p => p.id === playerId && p.cards.length > 0);
        if (isLoser) {
            elements.resultTitle.textContent = '😢 Вы проиграли!';
            elements.resultMessage.textContent = 'Вы остались в дураках...';
        } else {
            elements.resultTitle.textContent = '🎉 Победа!';
            elements.resultMessage.textContent = `${gameState.loser} остался в дураках!`;
        }
    } else {
        elements.resultTitle.textContent = '🤝 Ничья!';
        elements.resultMessage.textContent = 'Все сбросили карты одновременно';
    }
}

// Играть снова
function playAgain() {
    elements.resultModal.classList.remove('active');
    showScreen('lobby');
    gameState = null;
    selectedCard = null;
}

// Показ уведомления
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    elements.notifications.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Запуск
init();
