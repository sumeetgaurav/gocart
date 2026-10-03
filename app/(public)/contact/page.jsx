import { Mail, Phone, MapPin } from "lucide-react";

export default function ContactPage() {
    return (
        <div className='mx-6'>
            <div className='max-w-3xl mx-auto my-16'>
                <div className='text-center'>
                    <h1 className='text-3xl font-semibold text-slate-800'>Contact Us</h1>
                    <p className='mt-4 text-slate-600'>
                        Have a question about an order, a store, or GoCart Plus? Reach out
                        and our team will get back to you.
                    </p>
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-3 gap-6 mt-10'>
                    <a
                        href='mailto:contact@example.com'
                        className='flex flex-col items-center gap-2 p-6 rounded-lg border border-slate-200 hover:border-slate-300 transition text-center'
                    >
                        <Mail className='text-green-600' size={22} />
                        <span className='text-sm text-slate-600'>contact@example.com</span>
                    </a>
                    <a
                        href='tel:+12124567890'
                        className='flex flex-col items-center gap-2 p-6 rounded-lg border border-slate-200 hover:border-slate-300 transition text-center'
                    >
                        <Phone className='text-green-600' size={22} />
                        <span className='text-sm text-slate-600'>+1-212-456-7890</span>
                    </a>
                    <div className='flex flex-col items-center gap-2 p-6 rounded-lg border border-slate-200 text-center'>
                        <MapPin className='text-green-600' size={22} />
                        <span className='text-sm text-slate-600'>794 Francisco, 94102</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
