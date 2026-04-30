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

// Comprar vários números - fica PENDENTE
app.post('/comprar-numero', async (req, res) => {
  await liberarReservasExpiradas();

  const { rifaId, comprador, whatsapp, quantidade } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();
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

// Confirmar pagamento
app.post('/confirmar-pagamento', async (req, res) => {
  const { rifaId, numero, usuario } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  if (usuario && rifa.usuario !== usuario) {
    return res.json({ mensagem: 'Sem permissão ❌', sucesso: false });
  }

  const numeroAtual = rifa.numeros.find(n => Number(n.numero) === Number(numero));

  if (!numeroAtual) {
    return res.json({ mensagem: 'Número não encontrado ❌', sucesso: false });
  }

  if (numeroAtual.status === 'vendido') {
    return res.json({ mensagem: 'Esse número já está vendido ✅', sucesso: true });
  }

  if (numeroAtual.status !== 'pendente') {
    return res.json({ mensagem: 'Esse número não está pendente ❌', sucesso: false });
  }

  const novosNumeros = rifa.numeros.map(n => {
    if (Number(n.numero) === Number(numero)) {
      return {
        ...n,
        status: 'vendido',
        pagoEm: Date.now()
      };
    }

    return n;
  });

  await ref.update({ numeros: novosNumeros });

  res.json({ mensagem: `Pagamento confirmado para o número ${numero} ✅`, sucesso: true });
});

// Cancelar reserva
app.post('/cancelar-reserva', async (req, res) => {
  const { rifaId, numero, usuario } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  if (usuario && rifa.usuario !== usuario) {
    return res.json({ mensagem: 'Sem permissão ❌', sucesso: false });
  }

  const numeroAtual = rifa.numeros.find(n => Number(n.numero) === Number(numero));

  if (!numeroAtual) {
    return res.json({ mensagem: 'Número não encontrado ❌', sucesso: false });
  }

  if (numeroAtual.status !== 'pendente') {
    return res.json({ mensagem: 'Esse número não está pendente ❌', sucesso: false });
  }

  const novosNumeros = rifa.numeros.map(n => {
    if (Number(n.numero) === Number(numero)) {
      return {
        numero: n.numero,
        status: 'disponivel',
        comprador: null
      };
    }

    return n;
  });

  await ref.update({ numeros: novosNumeros });

  res.json({ mensagem: `Reserva do número ${numero} cancelada ✅`, sucesso: true });
});

// Sortear ganhador
app.post('/sortear-ganhador', async (req, res) => {
  await liberarReservasExpiradas();

  const { rifaId, usuario } = req.body;

  const ref = db.collection('rifas').doc(rifaId);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  if (rifa.usuario !== usuario) {
    return res.json({ mensagem: 'Sem permissão ❌', sucesso: false });
  }

  if (rifa.ganhador) {
    return res.json({ mensagem: 'Já sorteada 🏆', sucesso: true });
  }

  const vendidos = rifa.numeros.filter(n => n.status === 'vendido');

  if (vendidos.length === 0) {
    return res.json({ mensagem: 'Sem números pagos para sortear ❌', sucesso: false });
  }

  const ganhador = vendidos[Math.floor(Math.random() * vendidos.length)];

  await ref.update({
    ganhador: {
      numero: ganhador.numero,
      comprador: ganhador.comprador
    }
  });

  res.json({
    mensagem: `Ganhador: ${ganhador.comprador} (${ganhador.numero}) 🏆`,
    sucesso: true
  });
});

// Rota extra para o botão antigo de sortear funcionar
app.get('/sortear-rifa/:id', async (req, res) => {
  await liberarReservasExpiradas();

  const id = req.params.id;

  const ref = db.collection('rifas').doc(id);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();

  if (rifa.ganhador) {
    return res.json({ mensagem: 'Já sorteada 🏆', sucesso: true });
  }

  const vendidos = rifa.numeros.filter(n => n.status === 'vendido');

  if (vendidos.length === 0) {
    return res.json({ mensagem: 'Sem números pagos para sortear ❌', sucesso: false });
  }

  const ganhador = vendidos[Math.floor(Math.random() * vendidos.length)];

  await ref.update({
    ganhador: {
      numero: ganhador.numero,
      comprador: ganhador.comprador
    }
  });

  res.json({
    mensagem: `Ganhador: ${ganhador.comprador} (${ganhador.numero}) 🏆`,
    sucesso: true,
    numero: ganhador.numero,
    comprador: ganhador.comprador
  });
});

// Excluir rifa
app.delete('/excluir-rifa/:id', async (req, res) => {
  await liberarReservasExpiradas();

  const id = req.params.id;

  const ref = db.collection('rifas').doc(id);
  const doc = await ref.get();

  if (!doc.exists) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const rifa = doc.data();
  const temVendidos = rifa.numeros.some(n => n.status === 'vendido');

  if (temVendidos && !rifa.ganhador) {
    return res.json({
      mensagem: 'Sorteie o ganhador antes de excluir ❌',
      sucesso: false
    });
  }

  await ref.delete();

  res.json({ mensagem: 'Rifa excluída 🗑️', sucesso: true });
});

// Render
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});