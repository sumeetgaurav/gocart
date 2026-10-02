'use client'
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import Banner from "@/components/Banner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { setProduct } from "@/lib/features/product/productSlice";
import { setCart } from "@/lib/features/cart/cartSlice";
import { setAddressList } from "@/lib/features/address/addressSlice";

export default function PublicLayout({ children }) {

    const dispatch = useDispatch();

    useEffect(() => {
        fetch('/api/products')
            .then(res => res.json())
            .then(data => dispatch(setProduct(data)))
            .catch(() => {});

        fetch('/api/cart')
            .then(res => res.ok ? res.json() : null)
            .then(data => data && dispatch(setCart(data.cartItems)))
            .catch(() => {});

        fetch('/api/address')
            .then(res => res.ok ? res.json() : null)
            .then(data => data && dispatch(setAddressList(data)))
            .catch(() => {});
    }, []);

    return (
        <>
            <Banner />
            <Navbar />
            {children}
            <Footer />
        </>
    );
}
