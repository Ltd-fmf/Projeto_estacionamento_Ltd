import tkinter as tk
from tkinter import *
from tkinter import ttk, messagebox, filedialog
from PIL import Image, ImageTk  # Para lidar com imagens
# from tkinter import font as tkfont
import os
import shutil

# importanto view
from view import *

################# cores ###############
co0 = "#f0f3f5"  # Preta
co1 = "#feffff"  # branca
co2 = "#4fa882"  # verde
co3 = "#38576b"  # valor
co4 = "#403d3d"  # letra
co5 = "#D2691e"  # chocolate
co6 = "#038cfc"  # azul
co7 = "#ef5350"  # vermelha
co8 = "#263238"  # + verde
co9 = "#e9edf5"  # sky blue
################# criando janela ###############

janela = tk.Tk()
janela.title("Controle de Carros - PGEAM v1")

# Configuração da janela principal
janela.geometry("1043x553")  # Aumentei a altura para acomodar melhor os elementos
janela.iconbitmap("carro3.ico")
janela.configure(background=co9)
janela.resizable(width=FALSE, height=FALSE)

# Centralizar a janela
largura_janela = 1043
altura_janela = 553
largura_tela = janela.winfo_screenwidth()
altura_tela = janela.winfo_screenheight()
pos_x = (largura_tela - largura_janela) // 2
pos_y = (altura_tela - altura_janela) // 2
janela.geometry(f"{largura_janela}x{altura_janela}+{pos_x}+{pos_y}")

################# dividindo a Janela ###############
frameCima = Frame(janela, width=310, height=60, bg=co2, relief='flat')
frameCima.grid(row=0, column=0, sticky="nsew")

frameBaixo = Frame(janela, width=310, height=493, bg=co1, relief='flat')
frameBaixo.grid(row=1, column=0, sticky=NSEW, padx=0, pady=1)

frameDireita = Frame(janela, width=733, height=553, bg=co1, relief='flat')
frameDireita.grid(row=0, column=1, rowspan=2, padx=1, pady=0, sticky=NSEW)

################# Label cima ###############
# app_nome = Label(frameCima, text="** CONSULTA DE CARROS **", anchor=NW,
#                 font=('Ivy 15 bold'), bg=co2, fg=co1, relief='flat')
# app_nome.place(x=10, y=15)

Label(frameCima, text="** CONSULTA DE CARROS **", anchor=NW,
      font=('Ivy 15 bold'), bg=co2, fg=co1, relief='flat').place(x=10, y=15)

# variavel tree global
global tree

# Funções Imagem
def escolher_imagem():
    global imagem_path
    imagem_path = filedialog.askopenfilename(
        title="Escolha a imagem do carro",
        filetypes=[("Imagens", "*.jpg *.jpeg *.png *.bmp")])
    if imagem_path:
        messagebox.showinfo("Imagem Selecionada", f"{os.path.basename(imagem_path)}")

# funcao Inserir
def inserir():
    placa = e_placa.get()
    nome = e_nome.get()
    setor = e_setor.get()
    ramal = e_ramal.get()
    modelo = e_modelo.get()
    cor = e_cor.get()

    lista_inserir = [placa, nome, setor, ramal, modelo, cor]

    if e_placa.get() == '':
        messagebox.showerror('Erro', 'A placa não pode ser vazia')
    else:
        inserir_info(lista_inserir)
        messagebox.showinfo('Sucesso', 'Os dados foram inseridos com sucesso!')

        e_placa.delete(0, 'end')
        e_nome.delete(0, 'end')
        e_setor.delete(0, 'end')
        e_ramal.delete(0, 'end')
        e_modelo.delete(0, 'end')
        e_cor.delete(0, 'end')

    for widget in frameDireita.winfo_children():
        widget.destroy()
    mostrar()


# funçao atualizar
def atualizar():
    try:
        treev_dados = tree.focus()
        treev_dicionario = tree.item(treev_dados)
        tree_lista = treev_dicionario['values']

        valor_id = tree_lista[0]

        e_placa.delete(0, 'end')
        e_nome.delete(0, 'end')
        e_setor.delete(0, 'end')
        e_ramal.delete(0, 'end')
        e_modelo.delete(0, 'end')
        e_cor.delete(0, 'end')

        e_placa.insert(0, tree_lista[1])
        e_nome.insert(0, tree_lista[2])
        e_setor.insert(0, tree_lista[3])
        e_ramal.insert(0, tree_lista[4])
        e_modelo.insert(0, tree_lista[5])
        e_cor.insert(0, tree_lista[6])

        def update():
            placa = e_placa.get()
            nome = e_nome.get()
            setor = e_setor.get()
            ramal = e_ramal.get()
            modelo = e_modelo.get()
            cor = e_cor.get()

            lista_inserir = [placa, nome, setor, ramal, modelo, cor, valor_id]

            if e_placa.get() == '':
                messagebox.showerror('Erro', 'A placa não pode ser vazia')
            else:
                atualizar_info(lista_inserir)
                messagebox.showinfo('Sucesso', 'Os dados foram atualizados com sucesso!')

                # Oculta o botão após confirmar
                b_confirmar.destroy()

                e_placa.delete(0, 'end')
                e_nome.delete(0, 'end')
                e_setor.delete(0, 'end')
                e_ramal.delete(0, 'end')
                e_modelo.delete(0, 'end')
                e_cor.delete(0, 'end')

            for widget in frameDireita.winfo_children():
                widget.destroy()
            mostrar()

        # Botão confirmar
        b_confirmar = Button(frameBaixo, command=update, text='Confirmar', width=10,
                             font=('Ivy 9 bold'), bg=co2, fg=co1, relief='raised', overrelief='ridge')
        b_confirmar.place(x=115, y=380)

    except IndexError:
        messagebox.showerror('Erro', 'Selecione um registro na tabela')


# funcao deletar
def deletar():
    try:
        treev_dados = tree.focus()
        treev_dicionario = tree.item(treev_dados)
        treev_lista = treev_dicionario['values']

        valor_id = [treev_lista[0]]
        deletar_info(valor_id)

        messagebox.showinfo('Sucesso', 'Registro deletado com sucesso!')

        for widget in frameDireita.winfo_children():
            widget.destroy()
        mostrar()

    except IndexError:
        messagebox.showerror('Erro', 'Selecione um registro na tabela')


# Função para exibir detalhes do carro em uma nova janela
def exibir_detalhes_carro(registro):
    detalhes_janela = Toplevel()
    detalhes_janela.title("Detalhes do Veículo")
    detalhes_janela.geometry("500x400")
    detalhes_janela.resizable(False, False)
    detalhes_janela.configure(bg='#e9edf5')

    try:
        detalhes_janela.iconbitmap("carro3.ico")
    except Exception as e:
        print("Ícone não carregado:", e)

    # Centralizar a janela de detalhes
    largura = 500
    altura = 400
    pos_x = (janela.winfo_screenwidth() - largura) // 2
    pos_y = (janela.winfo_screenheight() - altura) // 2
    detalhes_janela.geometry(f"{largura}x{altura}+{pos_x}+{pos_y}")

    # Frame para a imagem
    frame_imagem = Frame(detalhes_janela, bg=co9)
    frame_imagem.pack(pady=10)

    try:
        # Carrega uma imagem de carro padrão (substitua pelo caminho da sua imagem)
        imagem_carro = Image.open("carro_padrao.png")
        imagem_carro = imagem_carro.resize((200, 150), Image.LANCZOS)
        foto = ImageTk.PhotoImage(imagem_carro)
        label_imagem = Label(frame_imagem, image=foto, bg=co9)
        label_imagem.image = foto
        label_imagem.pack()
    except:
        label_sem_imagem = Label(frame_imagem, text="Imagem não disponível",
                                 font=('Arial 10'), bg=co9)
        label_sem_imagem.pack()

    # Frame para os detalhes
    frame_detalhes = Frame(detalhes_janela, bg=co9)
    frame_detalhes.pack(pady=10)

    # Labels com os detalhes (fonte maior)
    font_detalhes = ('Arial', 14)

    Label(frame_detalhes, text=f"Placa: {registro[1]}", font=font_detalhes,
          bg=co9, anchor='w').pack(fill='x', pady=5)
    Label(frame_detalhes, text=f"Nome: {registro[2]}", font=font_detalhes,
          bg=co9, anchor='w').pack(fill='x', pady=5)
    Label(frame_detalhes, text=f"Setor: {registro[3]}", font=font_detalhes,
          bg=co9, anchor='w').pack(fill='x', pady=5)
    Label(frame_detalhes, text=f"Ramal: {registro[4]}", font=font_detalhes,
          bg=co9, anchor='w').pack(fill='x', pady=5)
    Label(frame_detalhes, text=f"Modelo: {registro[5]}", font=font_detalhes,
          bg=co9, anchor='w').pack(fill='x', pady=5)
    Label(frame_detalhes, text=f"Cor: {registro[6]}", font=font_detalhes,
          bg=co9, anchor='w').pack(fill='x', pady=5)

    # Botão fechar
    Button(detalhes_janela, text="Fechar", command=detalhes_janela.destroy,
           font=('Arial 10 bold'), bg=co7, fg=co1).pack(pady=10)


# Função para localizar um registro por placa
def localizar():
    placa_desejada = e_localizar.get().strip().upper()

    if not placa_desejada:
        messagebox.showwarning('Aviso', 'Digite uma placa para pesquisar')
        e_localizar.focus_set()
        return

    registros = selecionar_info()
    encontrado = None

    for registro in registros:
        if registro[1].upper() == placa_desejada:
            encontrado = registro
            break

    if encontrado:
        exibir_detalhes_carro(encontrado)
    else:
        messagebox.showerror('Erro', f'Nenhum veículo encontrado com a placa: {placa_desejada}')

    e_localizar.delete(0, 'end')
    e_localizar.focus_set()
    print(encontrado)

################# Configurando Frame baixo ###############
# Configurando fonte padrão para os campos
fonte_padrao = ('Arial', 12)

# placa
l_placa = Label(frameBaixo, text='Placa *', anchor=NW, font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_placa.place(x=15, y=10)
e_placa = Entry(frameBaixo, width=20, justify='left', relief='solid', font=fonte_padrao)
e_placa.place(x=15, y=40)

# nome
l_nome = Label(frameBaixo, text='Nome *', anchor=NW, font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_nome.place(x=15, y=70)
e_nome = Entry(frameBaixo, width=31, justify='left', relief='solid', font=fonte_padrao)
e_nome.place(x=15, y=100)

# setor
l_setor = Label(frameBaixo, text='Setor *', anchor=NW, font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_setor.place(x=15, y=130)
e_setor = Entry(frameBaixo, width=15, justify='left', relief='solid', font=fonte_padrao)
e_setor.place(x=15, y=160)

# ramal
l_ramal = Label(frameBaixo, text='Ramal *', anchor=NW, font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_ramal.place(x=165, y=130)
e_ramal = Entry(frameBaixo, width=14, justify='left', relief='solid', font=fonte_padrao)
e_ramal.place(x=165, y=160)

# modelo
l_modelo = Label(frameBaixo, text='Modelo *', anchor=NW, font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_modelo.place(x=15, y=190)
e_modelo = Entry(frameBaixo, width=15, justify='left', relief='solid', font=fonte_padrao)
e_modelo.place(x=15, y=220)

# cor
l_cor = Label(frameBaixo, text='Cor *', anchor=NW, font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_cor.place(x=165, y=190)
e_cor = Entry(frameBaixo, width=14, justify='left', relief='solid', font=fonte_padrao)
e_cor.place(x=165, y=220)

# Localizar
l_localizar = Label(frameBaixo, text='Localizar Placa:', anchor=NW,
                    font=('Arial 12 bold'), bg=co1, fg=co4, relief='flat')
l_localizar.place(x=15, y=260)
e_localizar = Entry(frameBaixo, width=14, justify='left', relief='solid', font=fonte_padrao)
e_localizar.place(x=165, y=260)

# Botões com estilo moderno
style = ttk.Style()
style.configure('TButton', font=('Arial', 13, 'bold'), padding=5)

# Botão inserir
b_inserir = ttk.Button(frameBaixo, text='Inserir', command=inserir, style='TButton')
b_inserir.place(x=15, y=300, width=90)

# Botão atualizar
b_atualizar = ttk.Button(frameBaixo, text='Atualizar', command=atualizar, style='TButton')
b_atualizar.place(x=110, y=300, width=90)

# Botão deletar
b_deletar = ttk.Button(frameBaixo, text='Deletar', command=deletar, style='TButton')
b_deletar.place(x=205, y=300, width=90)

# Botão localizar
style = ttk.Style()
style.configure('FonteVermelha.TButton', foreground='#ef5350', font=('Ivy', 12, 'bold'))

b_localizar = ttk.Button(frameBaixo, text='Localizar', command=localizar, style='FonteVermelha.TButton')
b_localizar.place(x=110, y=340, width=90)


########################## frame direita ########################
def mostrar():
    # lista para cabecario
    tabela_head = ['ID', 'Placa', 'Nome', 'Setor', 'Ramal', 'Modelo', 'Cor']

    df_list = selecionar_info()

    global tree

    # Limpa o frame direito antes de recriar a tabela
    for widget in frameDireita.winfo_children():
        widget.destroy()

    # Criando a tabela com estilo moderno
    style = ttk.Style()
    style.configure("Treeview.Heading", font=('Arial', 10, 'bold'))
    style.configure("Treeview", font=('Arial', 10), rowheight=25)

    # Criando a tabela
    tree = ttk.Treeview(frameDireita, selectmode="extended", columns=tabela_head, show="headings")

    # Scrollbars
    vsb = ttk.Scrollbar(frameDireita, orient="vertical", command=tree.yview)
    hsb = ttk.Scrollbar(frameDireita, orient="horizontal", command=tree.xview)
    tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

    tree.grid(column=0, row=0, sticky='nsew')
    vsb.grid(column=1, row=0, sticky='ns')
    hsb.grid(column=0, row=1, sticky='ew')

    frameDireita.grid_rowconfigure(0, weight=12)
    frameDireita.grid_columnconfigure(0, weight=1)

    # Configurando colunas
    hd = ["center", "center", "center", "center", "center", "center", "center"]
    h = [50, 100, 180, 100, 80, 120, 100]
    n = 0

    for col in tabela_head:
        tree.heading(col, text=col.title(), anchor=CENTER)
        tree.co