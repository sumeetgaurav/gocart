import OurSpecs from "@/components/OurSpec";

export default function AboutPage() {
    return (
        <div className='mx-6'>
            <div className='max-w-3xl mx-auto my-16 text-center'>
                <h1 className='text-3xl font-semibold text-slate-800'>About GoCart</h1>
                <p className='mt-4 text-slate-600'>
                    GoCart is your ultimate destination for the latest and smartest gadgets.
                    From smartphones and smartwatches to essential accessories, we bring
                    together independent sellers and shoppers on one platform, so you can
                    discover innovation without the hassle of shopping around.
                </p>
                <p className='mt-4 text-slate-600'>
                    Whether you&apos;re browsing as a shopper or growing your own store with
                    GoCart Plus, our goal is the same: make online shopping fast, secure, and
                    genuinely enjoyable.
                </p>
            </div>

            <OurSpecs />
        </div>
    );
}
