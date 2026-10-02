import { configureStore } from '@reduxjs/toolkit'
import cartReducer from './features/cart/cartSlice'
import productReducer from './features/product/productSlice'
import addressReducer from './features/address/addressSlice'
import ratingReducer from './features/rating/ratingSlice'

// Persists local cart edits (add/remove/delete/clear) to the backend,
// skipping 'cart/setCart' so hydrating from the server doesn't loop back.
const cartSyncMiddleware = (store) => (next) => (action) => {
    const result = next(action)

    if (typeof action.type === 'string' && action.type.startsWith('cart/') && action.type !== 'cart/setCart') {
        const { cartItems } = store.getState().cart
        fetch('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cartItems }),
        }).catch(() => {})
    }

    return result
}

export const makeStore = () => {
    return configureStore({
        reducer: {
            cart: cartReducer,
            product: productReducer,
            address: addressReducer,
            rating: ratingReducer,
        },
        middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(cartSyncMiddleware),
    })
}
