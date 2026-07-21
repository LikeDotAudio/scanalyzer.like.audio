#!/usr/bin/env python3
import sys

try:
    import mysql.connector
    from mysql.connector import Error
except ImportError:
    print("The 'mysql-connector-python' package is required but not found.")
    print("Please install it by running: pip install mysql-connector-python")
    sys.exit(1)

def test_connection():
    try:
        print("Attempting to connect to the database...")
        connection = mysql.connector.connect(
            host='scanalyzer.like.audio',
            database='tandapho_scanalyzer',
            user='tandapho_scanalyzer',
            password='z7hGhX)x)?UXtuo]'
        )
        if connection.is_connected():
            db_info = connection.get_server_info()
            print("✅ Successfully connected to MySQL Server version:", db_info)
            
            cursor = connection.cursor()
            cursor.execute("select database();")
            record = cursor.fetchone()
            print("✅ You're connected to database:", record[0])
            
            # Check if the 'peaks' table has been created by the Rust analyzer yet
            cursor.execute("SHOW TABLES LIKE 'peaks';")
            if cursor.fetchone():
                print("✅ Table 'peaks' exists and is ready!")
                
                # Fetch a quick count
                cursor.execute("SELECT COUNT(*) FROM peaks;")
                count = cursor.fetchone()[0]
                print(f"📊 There are currently {count} peak records stored in the database.")
            else:
                print("⚠️ Table 'peaks' does not exist yet (it will be created automatically when you run the Rust analyzer).")
                
    except Error as e:
        print("❌ Error while connecting to MySQL:")
        print(e)
    finally:
        if 'connection' in locals() and connection.is_connected():
            cursor.close()
            connection.close()
            print("\n🔌 MySQL connection is closed.")

if __name__ == '__main__':
    test_connection()
