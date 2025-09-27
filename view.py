# importanto meu SQLITE
import sqlite3 as lite

# criando conexão
conn = lite.connect('dados.db')

# inserir formulario
def inserir_info(i):
    with conn:
        cur = conn.cursor()
        query = 'INSERT INTO formulario (placa,nome,setor,ramal,modelo,cor) VALUES (?,?,?,?,?,?)'
        cur.execute(query, i)

# Deletar formulario
def deletar_info(i):
    with conn:
        cur = conn.cursor()
        query = 'DELETE FROM Formulario where id=?'
        cur.execute(query, i)

# Atualizar Formulario
def atualizar_info(i):
    with conn:
        cur = conn.cursor()
        query = "UPDATE formulario SET placa=?, nome=?, setor=?, ramal=?, modelo=?, cor=? WHERE id=?"
        cur.execute(query, i)
def selecionar_info():
    lista_info = []

    with conn:
        cur = conn.cursor()
        cur.execute('SELECT id, placa, nome, setor, ramal, modelo, cor FROM formulario')
        rows = cur.fetchall()

        for row in rows:
            lista_info.append(row)
    return lista_info



listas = selecionar_info()
