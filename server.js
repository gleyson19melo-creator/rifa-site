const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const usuarios = [];
const rifas = [];

// Rota inicial
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Cadastro
app.post('/cadastro', (req, res) => {
  const { nome, email, senha } = req.body;

  const existe = usuarios.find(u => u.email === email);
  if (existe) {
    return res.json({ mensagem: 'Email já cadastrado ❌', sucesso: false });
  }

  usuarios.push({ nome, email, senha });

  res.json({ mensagem: 'Conta criada com sucesso 🚀', sucesso: true });
});

// Login
app.post('/login', (req, res) => {
  const { email, senha } = req.body;

  const usuario = usuarios.find(u => u.email === email && u.senha === senha);

  if (!usuario) {
    return res.json({ mensagem: 'Email ou senha incorretos ❌', sucesso: false });
  }

  res.json({ mensagem: 'Login realizado com sucesso 🚀', sucesso: true });
});

// Criar rifa
app.post('/criar-rifa', (req, res) => {
  const { nome, valor, quantidade, usuario } = req.body;

  const numeros = [];

  for (let i = 1; i <= Number(quantidade); i++) {
    numeros.push({
      numero: i,
      status: 'disponivel'
    });
  }

  const novaRifa = {
    id: Date.now(),
    nome,
    valor,
    quantidade,
    usuario,
    numeros
  };

  rifas.push(novaRifa);

  console.log('Rifas:', rifas);

  res.json({ mensagem: 'Rifa criada com sucesso 🚀', sucesso: true });
});

// Listar rifas do usuário
app.get('/rifas/:usuario', (req, res) => {
  const usuario = req.params.usuario;
  const minhasRifas = rifas.filter(rifa => rifa.usuario === usuario);
  res.json(minhasRifas);
});

// Listar todas as rifas públicas na tela inicial
app.get('/rifas-publicas', (req, res) => {
  res.json(rifas);
});

// Buscar rifa por ID
app.get('/rifa/:id', (req, res) => {
  const id = Number(req.params.id);
  const rifa = rifas.find(r => r.id === id);
  res.json(rifa || null);
});

// Comprar número aleatório
app.post('/comprar-numero', (req, res) => {
  const { rifaId, comprador } = req.body;

  const rifa = rifas.find(r => r.id == rifaId);

  if (!rifa) {
    return res.json({ mensagem: 'Rifa não encontrada ❌', sucesso: false });
  }

  const disponiveis = rifa.numeros.filter(n => n.status === 'disponivel');

  if (disponiveis.length === 0) {
    return res.json({ mensagem: 'Todos os números já foram vendidos ❌', sucesso: false });
  }

  const sorteado = disponiveis[Math.floor(Math.random() * disponiveis.length)];

  sorteado.status = 'vendido';
  sorteado.comprador = comprador || 'Comprador';

  res.json({
    mensagem: `Compra realizada! Seu número é ${sorteado.numero} 🍀`,
    sucesso: true,
    numero: sorteado.numero
  });
});

// 🔥 IMPORTANTE PARA O RENDER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});