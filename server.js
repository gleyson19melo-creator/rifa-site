const express = require('express');
const admin = require('firebase-admin');

const app = express();

app.use(express.json());
app.use(express.static('public'));

// Tempo limite da reserva: 10 minutos
const TEMPO_LIMITE_RESERVA = 10 * 60 * 1000;

// Firebase
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require('./firebase.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Liberar reservas expiradas
async function liberarReservasExpiradas() {
  const snapshot = await db.collection('rifas').get();
  const agora = Date.now();

  snapshot.forEach(async (doc) => {
    const rifa = doc.data();

    if (!rifa.numeros) return;

    let alterou = false;

    const novosNumeros = rifa.numeros.map(n => {
      if (n.status === 'pendente' && n.reservadoEm) {
        const expirou = agora - n.reservadoEm > TEMPO_LIMITE_RESERVA;

        if (expirou) {
          alterou = true;

          return {
            numero: n.numero,
            status: 'disponivel',
            comprador: null
          };
        }
      }

      return n;
    });

    if (alterou) {
      await db.collection('rifas').doc(doc.id).update({
        numeros: novosNumeros
      });

      console.log(`Reservas expiradas liberadas na rifa: ${doc.id}`);
    }
  });
}

// Roda automaticamente a cada 1 minuto
setInterval(liberarReservasExpiradas, 60 * 1000);

// Roda também quando iniciar o servidor
liberarReservasExpiradas();

// Rota inicial
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Cadastro
app.post('/cadastro', async (req, res) => {
  const { nome, email, senha } = req.body;

  const snapshot = await db.collection('usuarios')
    .where('email', '==', email)
    .get();

  if (!snapshot.empty) {
    return res.json({ mensagem: 'Email já cadastrado ❌', sucesso: false });
  }

  await db.collection('usuarios').add({
    nome,
    email,
    senha,
    criadoEm: Date.now()
  });

  res.json({ mensagem: 'Conta criada com sucesso 🚀', sucesso: true });
});

// Login
app.post('/login', async (req, res) => {
  const { email, senha } = req.body;

  const snapshot = await db.collection('usuarios')
    .where('email', '==', email)
    .where('senha', '==', senha)
    .get();

  if (snapshot.empty) {
    return res.json({ mensagem: 'Email ou senha incorretos ❌', sucesso: false });
  }

  res.json({ mensagem: 'Login realizado com sucesso 🚀', sucesso: true });
});

// Criar rifa
app.post('/criar-rifa', async (req, res) => {
  const { nome, valor, quantidade, usuario, premio, chavePix } = req.body;

  const numeros = [];

  for (let i = 1; i <= Number(quantidade); i++) {
    numeros.push({
      numero: i,
      status: 'disponivel',
      comprador: null
    });
  }

  const novaRifa = {
    nome,
    valor,
    quantidade,
    usuario,
    premio: premio || 'Não informado',
    chavePix: chavePix || 'Não informado',
    numeros,
    ganhador: null,
    criadoEm: Date.now()
  };

  await db.collection('rifas').add(novaRifa);

  res.json({ mensagem: 'Rifa criada com sucesso 🚀', sucesso: true });
});

// Listar rifas do usuário
app.get('/rifas/:usuario', async (req, res) => {
  const usuario = req.params.usuario;

  const snapshot = await db.collection('rifas')
    .where('usuario', '==', usuario)
    .get();

  const rifas = [];

  snapshot.forEach(doc => {
    rifas.push({
      id: doc.id,
      ...doc.data()
    });
  });

  res.json(rifas);
});

// Listar rifas públicas
app.get('/rifas-publicas', async (req, res) => {
  await liberarReservasExpiradas();

  const snapshot = await db.collection('rifas').get();

  const rifas = [];

  snapshot.forEach(doc => {
    rifas.push({
      id: doc.id,
      ...doc.data()
    });
  });

  res.json(rifas);
});

// Buscar rifa
app.get('/rifa/:id', async (req, res) => {
  await liberarReservasExpiradas();

  const doc = await db.collection('rifas').doc(req.params.id).get();

  if (!doc.exists) return res.json(null);

  res.json({
    id: doc.id,
    ...doc.data()
  });
});

// 🚨 CORREÇÃO AQUI
app.post('/comprar-numero', async (req, res) => {
  await liberarReservasExpiradas();

  const { rifaId, comprador, whatsapp, quantidade } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  // 🔥 BLOQUEIO SE JÁ FOI SORTEADA
  if (rifa.ganhador) {
    return res.json({
      mensagem: 'Essa rifa já foi sorteada 🏆 Não é mais possível comprar.',
      sucesso: false
    });
  }

  const qtd = Number(quantidade) || 1;

  const disponiveis = rifa.numeros.filter(n => n.status === 'disponivel');

  if (disponiveis.length === 0) {
    return res.json({ mensagem: 'Todos os números já foram reservados ou vendidos ❌', sucesso: false });
  }

  if (qtd > disponiveis.length) {
    return res.json({
      mensagem: `Só restam ${disponiveis.length} números disponíveis ❌`,
      sucesso: false
    });
  }

  const numerosComprados = [];

  for (let i = 0; i < qtd; i++) {
    const livres = rifa.numeros.filter(n => n.status === 'disponivel');
    const sorteado = livres[Math.floor(Math.random() * livres.length)];

    rifa.numeros = rifa.numeros.map(n => {
      if (n.numero === sorteado.numero) {
        return {
          ...n,
          status: 'pendente',
          comprador: comprador || 'Comprador',
          whatsapp: whatsapp || '',
          reservadoEm: Date.now()
        };
      }

      return n;
    });

    numerosComprados.push(sorteado.numero);
  }

  await ref.update({ numeros: rifa.numeros });

  res.json({
    mensagem: `Reserva realizada! Seus números: ${numerosComprados.join(', ')} ⏳ Você tem 10 minutos para pagar.`,
    sucesso: true,
    numeros: numerosComprados
  });
});

// resto do código continua igual...