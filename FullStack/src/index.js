import dotenv from "dotenv"

dotenv.config({ path: './.env' })

// import mongoose, { connect, mongo } from "mongoose";
// import {ArpitDB} from "./constants"
import connectDB from "./db/index.js";

connectDB()










// First approach to connect DB

/*
import express from "express"
const app = express()

( async ()=> {
    try {
       await mongoose.connect(`${process.env.
        MONGODB_URI}/${DB_NAME}`)
        app.on("ERROR", (error) =>{
            console.log("ERRR:", error);
            throw error
        })

        app.listen(process.env.PORT, ()=> {
            console.log(`App is listening on port ${process.env.PORT}`); 
        })

    } catch (error) {
        console.error("ERROR:", error)
        throw err
    }
})()

*/