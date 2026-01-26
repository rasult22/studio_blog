const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Карточные масти и значения
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUE_ORDER = { '6': 0, '7': 1, '8': 2, '9': 3, '10': 4, 'J': 5, 'Q': 6, 'K': 7, 'A': 8 };

// Хранилище игр и игроков
const games = new Map();
const players = new Map();

// Создание колоды (36 карт)
function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value, id: `${value}_${suit}` });
        }
    }
    return shuffle(deck);
}

// Перемешивание колоды
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Создание новой игры
function createGame(hostId, hostName) {
    const gameId = uuidv4().substring(0, 6).toUpperCase();
    const game = {
        id: gameId,
        players: [{ id: hostId, name: hostName, cards: [], isReady: false }],
        deck: [],
        trump: null,
        trumpCard: null,
        table: [], // Карты на столе: [{attack: card, defense: card|null}]
        attacker: 0,
        defender: 1,
        currentTurn: 0,
        status: 'waiting', // waiting, playing, finished
        discardPile: [],
        passedPlayers: [],
        winner: null
    };
    games.set(gameId, game);
    return game;
}

// Присоединение к игре
function joinGame(gameId, playerId, playerName) {
    const game = games.get(gameId);
    if (!game) return { error: 'Игра не найдена' };
    if (game.status !== 'waiting') return { error: 'Игра уже началась' };
    if (game.players.length >= 6) return { error: 'Игра заполнена' };
    if (game.players.find(p => p.id === playerId)) return { error: 'Вы уже в игре' };

    game.players.push({ id: playerId, name: playerName, cards: [], isReady: false });
    return { success: true, game };
}

// Начать игру
function startGame(gameId) {
    const game = games.get(gameId);
    if (!game || game.players.length < 2) return { error: 'Недостаточно игроков' };

    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1];
    game.trump = game.trumpCard.suit;
    game.status = 'playing';
    game.table = [];
    game.discardPile = [];
    game.passedPlayers = [];

    // Раздача карт (по 6 каждому)
    for (const player of game.players) {
        player.cards = game.deck.splice(0, 6);
    }

    // Определяем, кто ходит первым (у кого младший козырь)
    let lowestTrump = null;
    let firstAttacker = 0;

    game.players.forEach((player, index) => {
        player.cards.forEach(card => {
            if (card.suit === game.trump) {
                if (!lowestTrump || VALUE_ORDER[card.value] < VALUE_ORDER[lowestTrump.value]) {
                    lowestTrump = card;
                    firstAttacker = index;
                }
            }
        });
    });

    game.attacker = firstAttacker;
    game.defender = (firstAttacker + 1) % game.players.length;
    game.currentTurn = firstAttacker;

    return { success: true, game };
}

// Проверка, может ли карта побить другую
function canBeat(attackCard, defenseCard, trump) {
    if (defenseCard.suit === attackCard.suit) {
        return VALUE_ORDER[defenseCard.value] > VALUE_ORDER[attackCard.value];
    }
    if (defenseCard.suit === trump && attackCard.suit !== trump) {
        return true;
    }
    return false;
}

// Проверка, можно ли подкинуть карту
function canAddCard(game, card) {
    if (game.table.length === 0) return true;

    const valuesOnTable = new Set();
    game.table.forEach(pair => {
        valuesOnTable.add(pair.attack.value);
        if (pair.defense) valuesOnTable.add(pair.defense.value);
    });

    return valuesOnTable.has(card.value);
}

// Атака
function attack(gameId, playerId, cardId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return { error: 'Игра не активна' };

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return { error: 'Игрок не найден' };

    const player = game.players[playerIndex];
    const cardIndex = player.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return { error: 'Карта не найдена' };

    // Проверяем, может ли игрок атаковать
    const isAttacker = playerIndex === game.attacker;
    const canAssist = game.table.length > 0 && playerIndex !== game.defender && !game.passedPlayers.includes(playerId);

    if (!isAttacker && !canAssist) return { error: 'Не ваш ход' };

    // Проверяем лимит карт на столе
    const defenderCards = game.players[game.defender].cards.length;
    const unbeatCards = game.table.filter(p => !p.defense).length;
    if (unbeatCards >= defenderCards) return { error: 'У защитника недостаточно карт' };
    if (game.table.length >= 6) return { error: 'Максимум 6 карт на столе' };

    const card = player.cards[cardIndex];

    if (!canAddCard(game, card)) return { error: 'Нельзя подкинуть эту карту' };

    player.cards.splice(cardIndex, 1);
    game.table.push({ attack: card, defense: null });
    game.passedPlayers = []; // Сбрасываем пасы при новой атаке

    return { success: true, game };
}

// Защита
function defend(gameId, playerId, attackCardId, defenseCardId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return { error: 'Игра не активна' };

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex !== game.defender) return { error: 'Вы не защищаетесь' };

    const player = game.players[playerIndex];
    const cardIndex = player.cards.findIndex(c => c.id === defenseCardId);
    if (cardIndex === -1) return { error: 'Карта не найдена' };

    const pairIndex = game.table.findIndex(p => p.attack.id === attackCardId && !p.defense);
    if (pairIndex === -1) return { error: 'Карта атаки не найдена' };

    const attackCard = game.table[pairIndex].attack;
    const defenseCard = player.cards[cardIndex];

    if (!canBeat(attackCard, defenseCard, game.trump)) {
        return { error: 'Эта карта не может побить' };
    }

    player.cards.splice(cardIndex, 1);
    game.table[pairIndex].defense = defenseCard;

    return { success: true, game };
}

// Взять карты
function takeCards(gameId, playerId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return { error: 'Игра не активна' };

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex !== game.defender) return { error: 'Вы не защищаетесь' };

    // Забираем все карты со стола
    const cardsToTake = [];
    game.table.forEach(pair => {
        cardsToTake.push(pair.attack);
        if (pair.defense) cardsToTake.push(pair.defense);
    });

    game.players[playerIndex].cards.push(...cardsToTake);
    game.table = [];
    game.passedPlayers = [];

    // Раздаём карты
    dealCards(game);

    // Следующий ход (защитник пропускает)
    game.attacker = (game.defender + 1) % game.players.length;
    game.defender = (game.attacker + 1) % game.players.length;

    // Пропускаем игроков без карт
    skipEmptyPlayers(game);

    checkGameEnd(game);

    return { success: true, game };
}

// Бито (отбился)
function pass(gameId, playerId) {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return { error: 'Игра не активна' };

    const playerIndex = game.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return { error: 'Игрок не найден' };
    if (playerIndex === game.defender) return { error: 'Защитник не может пасовать' };

    // Проверяем, есть ли непобитые карты
    const unbeatCards = game.table.filter(p => !p.defense);
    if (unbeatCards.length > 0) return { error: 'Есть непобитые карты' };

    if (!game.passedPlayers.includes(playerId)) {
        game.passedPlayers.push(playerId);
    }

    // Проверяем, все ли атакующие спасовали
    const attackers = game.players.filter((p, i) => i !== game.defender && p.cards.length > 0);
    const allPassed = attackers.every(p => game.passedPlayers.includes(p.id));

    if (allPassed && game.table.length > 0) {
        // Карты в отбой
        game.table.forEach(pair => {
            game.discardPile.push(pair.attack);
            if (pair.defense) game.discardPile.push(pair.defense);
        });
        game.table = [];
        game.passedPlayers = [];

        // Раздаём карты
        dealCards(game);

        // Следующий ход
        game.attacker = game.defender;
        game.defender = (game.attacker + 1) % game.players.length;

        // Пропускаем игроков без карт
        skipEmptyPlayers(game);

        checkGameEnd(game);
    }

    return { success: true, game };
}

// Раздача карт из колоды
function dealCards(game) {
    // Порядок раздачи: атакующий, затем остальные, защитник последний
    const order = [];
    let idx = game.attacker;
    for (let i = 0; i < game.players.length; i++) {
        if (idx !== game.defender) order.push(idx);
        idx = (idx + 1) % game.players.length;
    }
    order.push(game.defender);

    for (const playerIdx of order) {
        const player = game.players[playerIdx];
        while (player.cards.length < 6 && game.deck.length > 0) {
            player.cards.push(game.deck.shift());
        }
    }
}

// Пропуск игроков без карт
function skipEmptyPlayers(game) {
    const activePlayers = game.players.filter(p => p.cards.length > 0);
    if (activePlayers.length <= 1) return;

    while (game.players[game.attacker].cards.length === 0) {
        game.attacker = (game.attacker + 1) % game.players.length;
    }

    game.defender = (game.attacker + 1) % game.players.length;
    while (game.players[game.defender].cards.length === 0) {
        game.defender = (game.defender + 1) % game.players.length;
    }
}

// Проверка окончания игры
function checkGameEnd(game) {
    if (game.deck.length > 0) return;

    const playersWithCards = game.players.filter(p => p.cards.length > 0);

    if (playersWithCards.length === 0) {
        // Ничья
        game.status = 'finished';
        game.winner = null;
    } else if (playersWithCards.length === 1) {
        // Остался дурак
        game.status = 'finished';
        game.winner = playersWithCards[0].id;
        game.loser = playersWithCards[0].name;
    }
}

// Получить состояние игры для конкретного игрока
function getGameStateForPlayer(game, playerId) {
    const playerIndex = game.players.findIndex(p => p.id === playerId);

    return {
        id: game.id,
        status: game.status,
        trump: game.trump,
        trumpCard: game.deck.length > 0 ? game.trumpCard : null,
        deckCount: game.deck.length,
        table: game.table,
        attacker: game.attacker,
        defender: game.defender,
        currentPlayerId: playerId,
        currentPlayerIndex: playerIndex,
        players: game.players.map((p, i) => ({
            id: p.id,
            name: p.name,
            cardCount: p.cards.length,
            cards: p.id === playerId ? p.cards : [],
            isAttacker: i === game.attacker,
            isDefender: i === game.defender,
            isReady: p.isReady
        })),
        myCards: playerIndex >= 0 ? game.players[playerIndex].cards : [],
        canPass: playerIndex !== game.defender && game.table.filter(p => !p.defense).length === 0,
        winner: game.winner,
        loser: game.loser
    };
}

// WebSocket обработка
wss.on('connection', (ws) => {
    const playerId = uuidv4();
    players.set(playerId, { ws, gameId: null, name: 'Игрок' });

    ws.send(JSON.stringify({ type: 'connected', playerId }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(playerId, data, ws);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        const player = players.get(playerId);
        if (player && player.gameId) {
            const game = games.get(player.gameId);
            if (game) {
                // Уведомляем остальных о выходе игрока
                broadcastToGame(player.gameId, {
                    type: 'playerLeft',
                    playerId,
                    playerName: player.name
                });
            }
        }
        players.delete(playerId);
    });
});

function handleMessage(playerId, data, ws) {
    const player = players.get(playerId);

    switch (data.type) {
        case 'setName':
            player.name = data.name;
            ws.send(JSON.stringify({ type: 'nameSet', name: data.name }));
            break;

        case 'createGame':
            const newGame = createGame(playerId, player.name);
            player.gameId = newGame.id;
            ws.send(JSON.stringify({
                type: 'gameCreated',
                gameId: newGame.id,
                game: getGameStateForPlayer(newGame, playerId)
            }));
            break;

        case 'joinGame':
            const joinResult = joinGame(data.gameId.toUpperCase(), playerId, player.name);
            if (joinResult.error) {
                ws.send(JSON.stringify({ type: 'error', message: joinResult.error }));
            } else {
                player.gameId = data.gameId.toUpperCase();
                broadcastToGame(data.gameId.toUpperCase(), {
                    type: 'playerJoined',
                    game: null // Will be filled per player
                });
                broadcastGameState(data.gameId.toUpperCase());
            }
            break;

        case 'startGame':
            if (player.gameId) {
                const startResult = startGame(player.gameId);
                if (startResult.error) {
                    ws.send(JSON.stringify({ type: 'error', message: startResult.error }));
                } else {
                    broadcastToGame(player.gameId, { type: 'gameStarted' });
                    broadcastGameState(player.gameId);
                }
            }
            break;

        case 'attack':
            if (player.gameId) {
                const attackResult = attack(player.gameId, playerId, data.cardId);
                if (attackResult.error) {
                    ws.send(JSON.stringify({ type: 'error', message: attackResult.error }));
                } else {
                    broadcastGameState(player.gameId);
                }
            }
            break;

        case 'defend':
            if (player.gameId) {
                const defendResult = defend(player.gameId, playerId, data.attackCardId, data.defenseCardId);
                if (defendResult.error) {
                    ws.send(JSON.stringify({ type: 'error', message: defendResult.error }));
                } else {
                    broadcastGameState(player.gameId);
                }
            }
            break;

        case 'take':
            if (player.gameId) {
                const takeResult = takeCards(player.gameId, playerId);
                if (takeResult.error) {
                    ws.send(JSON.stringify({ type: 'error', message: takeResult.error }));
                } else {
                    broadcastGameState(player.gameId);
                }
            }
            break;

        case 'pass':
            if (player.gameId) {
                const passResult = pass(player.gameId, playerId);
                if (passResult.error) {
                    ws.send(JSON.stringify({ type: 'error', message: passResult.error }));
                } else {
                    broadcastGameState(player.gameId);
                }
            }
            break;

        case 'leaveGame':
            if (player.gameId) {
                broadcastToGame(player.gameId, {
                    type: 'playerLeft',
                    playerId,
                    playerName: player.name
                });
                player.gameId = null;
            }
            break;
    }
}

function broadcastToGame(gameId, message) {
    const game = games.get(gameId);
    if (!game) return;

    game.players.forEach(p => {
        const playerData = players.get(p.id);
        if (playerData && playerData.ws.readyState === WebSocket.OPEN) {
            playerData.ws.send(JSON.stringify(message));
        }
    });
}

function broadcastGameState(gameId) {
    const game = games.get(gameId);
    if (!game) return;

    game.players.forEach(p => {
        const playerData = players.get(p.id);
        if (playerData && playerData.ws.readyState === WebSocket.OPEN) {
            playerData.ws.send(JSON.stringify({
                type: 'gameState',
                game: getGameStateForPlayer(game, p.id)
            }));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🃏 Сервер игры "Дурак" запущен на порту ${PORT}`);
    console.log(`   Откройте http://localhost:${PORT} в браузере`);
});
