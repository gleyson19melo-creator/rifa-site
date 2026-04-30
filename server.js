const express = require('express');
const admin = require('firebase-admin');

const app = express();

app.use(express.json());
app.use(express.static('public'));

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
  const { nome, valor, quantidade, usuario } = req.body;

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

// Listar todas as rifas públicas
app.get('/rifas-publicas', async (req, res) => {
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

// Buscar rifa por ID
app.get('/rifa/:id', async (req, res) => {
  const doc = await db.collection('rifas').doc(req.params.id).get();

  if (!doc.exists) {
    return res.json(null);
  }

  res.json({
    id: doc.id,
    ...doc.data()
  });
});

// Comprar número aleatório
app.post('/comprar-numero', async (req, res) => {
  const { rifaId, comprador } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  const disponiveis = rifa.numeros.filter(n => n.status === 'disponivel');

  if (disponiveis.length === 0) {
    return res.json({ mensagem: 'Todos os números já foram vendidos ❌', sucesso: false });
  }

  const sorteado = disponiveis[Math.floor(Math.random() * disponiveis.length)];

  const numerosAtualizados = rifa.numeros.map(n => {
    if (n.numero === sorteado.numero) {
      return {
        ...n,
        status: 'vendido',
        comprador: comprador || 'Comprador'
      };
    }

    return n;
  });

  await ref.update({
    numeros: numerosAtualizados
  });

  res.json({
    mensagem: `Compra realizada! Seu número é ${sorteado.numero} 🍀`,
    sucesso: true,
    numero: sorteado.numero
  });
});

// Sortear ganhador da rifa
app.post('/sortear-ganhador', async (req, res) => {
  const { rifaId, usuario } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  if (rifa.usuario !== usuario) {
    return res.json({ mensagem: 'Você não tem permissão para sortear essa rifa ❌', sucesso: false });
  }

  if (rifa.ganhador) {
    return res.json({
      mensagem: `Essa rifa já foi sorteada. Ganhador: número ${rifa.ganhador.numero} - ${rifa.ganhador.comprador} 🏆`,
      sucesso: true,
      ganhador: rifa.ganhador
    });
  }

  const vendidos = rifa.numeros.filter(n => n.status === 'vendido');

  if (vendidos.length === 0) {
    return res.json({ mensagem: 'Ainda não tem números vendidos para sortear ❌', sucesso: false });
  }

  const ganhador = vendidos[Math.floor(Math.random() * vendidos.length)];

  const resultado = {
    numero: ganhador.numero,
    comprador: ganhador.comprador || 'Comprador',
    sorteadoEm: Date.now()
  };

  await ref.update({
    ganhador: resultado
  });

  res.json({
    mensagem: `Ganhador sorteado! Número ${resultado.numero} - ${resultado.comprador} 🏆`,
    sucesso: true,
    ganhador: resultado
  });
});

// Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});