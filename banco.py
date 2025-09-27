# importando meu SQLITE
import sqlite3 as lite

# criando a conexao
conn = lite.connect('dados.db')

# criando tabela
with conn:
    cur = conn.cursor()
    cur.execute("CREATE TABLE formulario(id INT, placa TEXT, nome TEXT, setor TEXT, ramal INT, modelo TEXT, cor TEXT)")

