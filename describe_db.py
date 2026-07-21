import mysql.connector

db = mysql.connector.connect(
    host="scanalyzer.like.audio",
    user="tandapho_scanalyzer",
    password="z7hGhX)x)?UXtuo]",
    database="tandapho_scanalyzer"
)
cursor = db.cursor()
cursor.execute("DESCRIBE peaks")
for row in cursor.fetchall():
    print(row)
